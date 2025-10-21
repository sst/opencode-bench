import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

export const systemPrompt = `You are evaluating whether an autonomous agent reproduced the exact API signatures from a reference git commit.

**YOUR ROLE**: Check if function/method/class signatures match EXACTLY.

IMPORTANT: You must give a BINARY score - either 0 (FAIL) or 1 (PASS). No intermediate values allowed.

---

## WHAT TO EVALUATE

An "API signature" is the public interface that other code depends on:

### For Functions/Methods:
- Function name (exact match required)
- Parameter names (exact order required, names should match)
- Parameter order (CRITICAL - must match exactly)
- Return type (if explicitly typed)

### For Classes:
- Class name (exact match required)
- Constructor signature
- Public method signatures

### What to IGNORE:
- Function body / implementation
- Internal variable names
- Code comments
- Formatting / whitespace
- Private methods (unless they're part of the public API)

---

## HOW TO EVALUATE

### Step 1: Extract All API Signatures

From both diffs, list out:
- All function definitions (name + parameters)
- All class definitions (name + public methods)
- All method definitions (name + parameters)

### Step 2: Compare Signatures One-by-One

For each signature in the reference, find it in the candidate:

**Function Example:**
\`\`\`
Reference: def submit_metric(response, context, options=None)
Candidate: def submit_metric(response, context, options=None)
-> MATCH
\`\`\`

**Parameter Order Example:**
\`\`\`
Reference: def submit_metric(response, context)
Candidate: def submit_metric(context, response)
-> NO MATCH - different parameter order
\`\`\`

**Parameter Names Example:**
\`\`\`
Reference: def process(data, config)
Candidate: def process(input_data, settings)
-> NO MATCH - different parameter names
\`\`\`

### Step 3: Make Your Decision

**PASS (1) if:**
- ALL function/method/class signatures match exactly
- Parameter order is identical
- Parameter names are identical (or very close synonyms like "ctx" vs "context")

**FAIL (0) if:**
- ANY function has different parameter order
- ANY function has different parameter names
- ANY function has different function name
- Missing signatures from reference

---

## EXAMPLES

**PASS Example:**
\`\`\`
Reference:
def calculate_total(items, tax_rate, discount=0.0):
    ...

Candidate:
def calculate_total(items, tax_rate, discount=0.0):
    # Different implementation but same signature
    ...
\`\`\`
**Verdict**: PASS - signature matches exactly

**FAIL Example:**
\`\`\`
Reference:
def calculate_total(items, tax_rate, discount=0.0):
    ...

Candidate:
def calculate_total(tax_rate, items, discount=0.0):
    ...
\`\`\`
**Verdict**: FAIL - parameter order changed (items and tax_rate swapped)

**FAIL Example:**
\`\`\`
Reference:
def process_request(request, context):
    ...

Candidate:
def process_request(req, ctx):
    ...
\`\`\`
**Verdict**: FAIL - parameter names changed (even though they're reasonable abbreviations)

---

## DECISION CRITERIA

This evaluation is STRICT. API signatures must match EXACTLY because:
- Call sites depend on the exact parameter order
- Type checkers validate parameter names
- Documentation references these signatures
- Breaking changes require version bumps

Return JSON with 'score' (0 or 1) and detailed rationale listing all signature mismatches found.`;

export function createUserPrompt(
  reference: string,
  candidateDiff: string,
): string {
  return `Reference diff:\n${reference}\n\nCandidate diff:\n${candidateDiff}\n\nCompare ONLY the API signatures (function names, parameter order, parameter names). Ignore implementation details. Respond with JSON.`;
}

export default createScore({
  prepare: async ({ evaluation }) => {
    try {
      const diff = await fetchComparisonDiff(evaluation);

      assert(
        diff.trim().length > 0,
        `API signature score requires a non-empty reference diff for ${evaluation.repo}.`,
      );

      return diff;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `API signature reference diff preparation failed: ${message}`,
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
        rationale: `API signature candidate diff generation failed: ${message}`,
      };
    }

    assert(
      typeof candidateDiff === "string" && candidateDiff.trim().length > 0,
      "API signature score requires a diff to compare.",
    );
    assert(
      typeof reference === "string" && reference.length > 0,
      "API signature score requires a reference diff to compare against.",
    );

    try {
      const { object } = await generateObject({
        model: judge.model,
        schema: scoreResultSchema,
        system: systemPrompt,
        temperature: 0,
        prompt: createUserPrompt(reference, candidateDiff),
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `API signature evaluation failed: ${message}`,
      };
    }
  },
});
