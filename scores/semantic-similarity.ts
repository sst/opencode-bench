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

## HOW TO EVALUATE (Like a Human Code Reviewer)

Think of yourself reviewing a PR that's supposed to implement the same feature as a reference commit.

### Step 1: What Changed?

Read both diffs and list out:
- **Files modified**: Which files were changed?
- **Functions added/modified**: What new functions or methods were created or changed?
- **External calls**: What libraries, APIs, or external services are used?
- **Tests added**: What scenarios are being tested?

### Step 2: Compare Section by Section

Go through each section in the reference diff and find the corresponding section in the candidate diff:

**For production code:**
- Is the same functionality present (even if implemented differently)?
- Are the same external APIs/libraries called?
- Are the functions integrated in the same places?

**For test code:**
- Are the same scenarios tested (happy path, errors, edge cases)?
- Are the same things being asserted (even with different test syntax)?

### Step 3: Recognize Equivalent Logic

These patterns are EQUIVALENT - treat them as matching:

**Guard clauses vs nested ifs:**
\`\`\`
// Reference
if (x != null && x.isValid()) {
  doWork();
}

// Candidate
if (!x) return;
if (!x.isValid()) return;
doWork();
\`\`\`
Both validate before doing work → EQUIVALENT

**Error handling patterns:**
\`\`\`
// Reference
if (error) { return error; }
process();

// Candidate
if (!error) { process(); }
\`\`\`
Both handle errors first → EQUIVALENT

**Independent operations can be reordered:**
\`\`\`
// Reference
logEvent();
submitMetric();

// Candidate
submitMetric();
logEvent();
\`\`\`
If operations don't depend on each other → EQUIVALENT

### Step 4: Make Your Decision

**PASS (1) if:**
- Same files modified (or very similar)
- Same functions/methods exist with same signatures
- Same external APIs/libraries used
- Same test scenarios covered
- At least 85% of reference changes present

**FAIL (0) if:**
- Missing critical files or functions
- Different libraries used (express vs fastify, requests vs urllib)
- Different function signatures (different parameters or parameter order)
- Missing test scenarios from reference
- Different assertions (asserts 200 when reference asserts 201)

---

## WHAT TO IGNORE

These are implementation details, NOT observable behavior:

- Variable names, formatting, comments
- Test structure (class-based vs function-based)
- Code organization within files
- Mock/stub approach in tests
- Statement ordering (if operations are independent)

---

## EXAMPLES

**PASS Example:**
- Reference: Creates function \`submit_metric(response, context)\`
- Candidate: Creates function \`submit_metric(response, context)\` with different variable names internally
- **PASS** - same observable API

**FAIL Example:**
- Reference: Creates function \`submit_metric(response, context)\`
- Candidate: Creates function \`submit_metric(context, response)\`
- **FAIL** - different parameter order = different API signature

**PASS Example:**
- Reference: Tests error case, happy path, null input
- Candidate: Tests error case, happy path, null input with different test framework
- **PASS** - same scenarios tested

**FAIL Example:**
- Reference: Tests error case, happy path, null input
- Candidate: Tests only error case and happy path
- **FAIL** - missing null input test scenario

---

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
