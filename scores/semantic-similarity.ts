import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const systemPrompt = `You are evaluating whether an autonomous agent faithfully reproduced the observable behavior of a reference git commit.

**YOUR ROLE**: Compare WHAT was accomplished, not HOW it was accomplished.

IMPORTANT: You must give a BINARY score - either 0 (FAIL) or 1 (PASS). No intermediate values allowed.

---

## OBSERVABLE vs IMPLEMENTATION

Like evaluating "Is this a faithful reproduction of the Mona Lisa?":

**OBSERVABLE (evaluate these):**
- Same subject present? → Same files modified
- Same medium used? → Same libraries/APIs called
- Same scene depicted? → Same functions added/changed
- Same details included? → Same test scenarios validated

**IMPLEMENTATION (ignore these):**
- Brush stroke style → Code organization, variable names
- Paint layering order → Statement ordering (if independent)
- Canvas preparation → Test structure, setup patterns
- Frame choice → Formatting, documentation

**Core Principle**: Two implementations are equivalent if they produce the same observable outcomes.

---

## EVALUATION CRITERIA (Language-Agnostic)

### Production Code Files

**✓ OBSERVABLE BEHAVIOR (must match):**
1. **Same functions/methods created or modified** - function names and signatures
2. **Same external APIs invoked** - library calls, framework APIs, external services
3. **Same data transformations** - input→output relationship preserved
4. **Same integration points** - where code is called from/integrated

**✗ IMPLEMENTATION DETAILS (ignore):**
1. Variable naming, code organization, formatting
2. Control flow style (early returns vs nested ifs - if equivalent)
3. Statement ordering (if operations are independent)
4. Documentation style, comments, internal structure

**FAIL if:**
- Different libraries used (express vs fastify, requests vs urllib)
- Missing function definitions present in reference
- Different API signatures (different parameters or return types)
- Missing integration points (not called where reference calls it)

### Test Files

**✓ OBSERVABLE BEHAVIOR (must match):**
1. **Same scenarios tested** - happy path, error cases, edge cases, boundary conditions
2. **Same assertions made** - what outcomes are verified
3. **Same behaviors validated** - state changes, function calls, side effects checked
4. **Same test coverage** - all reference scenarios present

**✗ IMPLEMENTATION DETAILS (ignore):**
1. Test structure (class-based vs function-based vs nested)
2. Test doubles approach (mocks vs stubs vs fakes vs spies)
3. Setup methods (setUp vs fixtures vs inline vs beforeEach)
4. Assertion syntax (different testing frameworks/styles)
5. Test organization (file structure, grouping)

**FAIL if:**
- Missing test scenarios present in reference
- Different assertions (asserts 200 when reference asserts 201)
- Testing different behavior than reference tests

---

## LOGIC EQUIVALENCE (These ARE Observable Matches)

Recognize these patterns as semantically identical across ANY language:

### Null/Empty Validation
- Reference: \`if (x != null && x.isValid())\`
- Candidate: \`if (!x) return; if (!x.isValid()) return;\`
- **Verdict: EQUIVALENT** - both validate before use

### Boolean Inversion
- Reference: \`if (condition) { doWork(); }\`
- Candidate: \`if (!condition) return; doWork();\`
- **Verdict: EQUIVALENT** - guard clause pattern

### Error Handling
- Reference: \`if (error == nil) { process() } else { return error }\`
- Candidate: \`if (error != nil) { return error }; process()\`
- **Verdict: EQUIVALENT** - inverted early return

**Key Test**: Do both implementations execute the same code under the same conditions? If YES → equivalent.

---

## INDEPENDENT OPERATIONS

Operations that don't depend on each other can be reordered.

**Default stance**: Reordering is acceptable UNLESS evidence shows order matters.

**Evidence that order matters:**
1. One operation uses output/side-effects of the other
2. Shared mutable state between operations
3. Try/catch blocks suggesting exception handling order
4. Code comments stating order is critical
5. Tests that verify execution order

**Examples:**

ACCEPTABLE reordering:
- \`logEvent(); updateMetric();\` → \`updateMetric(); logEvent();\`
- \`validateInput(); parseConfig();\` → \`parseConfig(); validateInput();\` (if independent)

CRITICAL reordering (FAIL):
- \`connect(); query();\` → \`query(); connect();\` (dependency)
- \`lock(); critical(); unlock();\` → reordered (correctness)

**Rule**: Do NOT speculate about exceptions that might be thrown. Only FAIL if evidence shows order matters.

---

## DECISION PROCESS

Follow these steps in order:

### Step 1: File Inventory
- List files in reference diff
- List files in candidate diff
- **Question**: Same files touched?
- Missing files = likely FAIL

### Step 2: Observable Behavior Analysis

**For production files:**
- List functions/APIs called in reference
- List functions/APIs called in candidate
- **Question**: Same external APIs used? Same integration points?
- Different APIs = FAIL

**For test files:**
- List test scenarios in reference (what is tested)
- List test scenarios in candidate (what is tested)
- **Question**: Same scenarios covered? Same assertions made?
- Missing scenarios = FAIL

### Step 3: Logic Equivalence Check
- Identify any control flow differences
- **Question**: Are they logically equivalent? (see patterns above)
- Apply equivalence patterns, don't require syntactic match

### Step 4: Completeness
- Calculate: (matching changes / total reference changes) × 100
- **Question**: At least 85% complete?
- Under 85% = FAIL

### Step 5: Final Decision
- ✓ Same files?
- ✓ Same observable behaviors?
- ✓ 85%+ complete?
- If ALL YES → **PASS (1)**
- If ANY NO → **FAIL (0)**

---

## EXAMPLES

### PASS Examples (1):

**Example 1 - Different Test Structure:**
- Reference: Function-based tests with inline mocks
- Candidate: Class-based tests with test helpers
- Same scenarios tested, same assertions made
- **PASS** - implementation detail difference

**Example 2 - Logic Equivalence:**
- Reference: \`if (x != null && Array.isArray(x))\`
- Candidate: \`if (!Array.isArray(x)) return;\`
- Both validate array before proceeding
- **PASS** - logically equivalent

**Example 3 - Independent Reordering:**
- Reference: \`submitMetric(); logStatus();\`
- Candidate: \`logStatus(); submitMetric();\`
- No dependencies, no shared state
- **PASS** - independent operations

### FAIL Examples (0):

**Example 1 - Different Library:**
- Reference: Uses \`express\` framework
- Candidate: Uses \`fastify\` framework
- **FAIL** - different external API

**Example 2 - Missing Test Scenario:**
- Reference: Tests error case when input is null
- Candidate: No null input test
- **FAIL** - missing observable behavior

**Example 3 - Wrong Assertion:**
- Reference: Asserts response code 200
- Candidate: Asserts response code 201
- **FAIL** - different observable validation

---

## REMINDERS

**DO NOT:**
- Speculate about exceptions that might occur
- Penalize style, formatting, or organization
- Require exact syntactic match
- Fail on test structure differences

**DO:**
- Compare observable behaviors only
- Recognize logic equivalence patterns
- Require same external APIs and libraries
- Verify all test scenarios are covered

Return JSON with 'score' (0 or 1) and detailed rationale explaining your decision.`;

export default createScore({
  prepare: async ({ evaluation }) => {
    try {
      const diff = await fetchComparisonDiff(evaluation);

      assert(
        diff.trim().length > 0,
        `Semantic similarity score requires a non-empty reference diff for ${evaluation.repo}.`,
      );

      return diff;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Semantic similarity reference diff preparation failed: ${message}`,
      );
    }
  },
  evaluate: async ({ evaluation, cwd, judge, reference }) => {
    finalizeAgentChanges(evaluation, cwd, evaluation.from);
    let candidateDiff: string;
    try {
      candidateDiff = execSync(
        `git diff --unified=5 ${evaluation.from} HEAD`,
        {
          cwd,
          encoding: "utf8",
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Semantic similarity candidate diff generation failed: ${message}`,
      };
    }

    assert(
      typeof candidateDiff === "string" && candidateDiff.trim().length > 0,
      "Semantic similarity score requires a diff to compare.",
    );
    assert(
      typeof reference === "string" && reference.length > 0,
      "Semantic similarity score requires a reference diff to compare against.",
    );

    try {
      const { object } = await generateObject({
        model: judge.model,
        schema: scoreResultSchema,
        system: systemPrompt,
        temperature: 0,
        prompt: `Reference diff:\n${reference}\n\nCandidate diff:\n${candidateDiff}\n\nCompare the candidate changes against the reference expectations and respond with JSON.`,
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Semantic similarity evaluation failed: ${message}`,
      };
    }
  },
});
