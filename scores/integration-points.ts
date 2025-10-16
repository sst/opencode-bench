import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const systemPrompt = `You are evaluating whether an autonomous agent integrated functions in the same places as a reference git commit.

**YOUR ROLE**: Check if functions are called from the same locations and in the same way.

IMPORTANT: You must give a BINARY score - either 0 (FAIL) or 1 (PASS). No intermediate values allowed.

---

## WHAT TO EVALUATE

Integration points are the places where new code connects to existing code:

### Key Integration Elements:
1. **Import statements** - where functions are imported
2. **Function calls** - where and how functions are invoked
3. **Call location** - in which file and function the call happens
4. **Call arguments** - what values are passed to the call
5. **Call timing** - when in the execution flow the call occurs

### What to IGNORE:
- Internal implementation of functions
- Variable names used for arguments
- Code formatting
- Comments

---

## HOW TO EVALUATE

### Step 1: List All Integration Points

From both diffs, identify:
- Where are imports added?
- Where are functions called?
- What arguments are passed?
- When in the flow does the call happen?

### Step 2: Compare Each Integration Point

**Import Location:**
```
Reference:
# In file: wrapper.py, line 47
from datadog_lambda.metric import submit_batch_item_failures_metric

Candidate:
# In file: wrapper.py, line 47
from datadog_lambda.metric import submit_batch_item_failures_metric
```
→ **MATCH** - same file, same import

**Call Location:**
```
Reference:
# In file: wrapper.py, inside _after() method, line 296
submit_batch_item_failures_metric(self.response, context)

Candidate:
# In file: wrapper.py, inside _after() method, line 296
submit_batch_item_failures_metric(self.response, context)
```
→ **MATCH** - same file, same function, same location

**Call Timing:**
```
Reference:
def _after(self, event, context):
    submit_batch_item_failures_metric(self.response, context)  # Line 296
    status_code = extract_http_status_code_tag(...)  # Line 298

Candidate:
def _after(self, event, context):
    cold_start_trace_logic(...)  # Line 360
    submit_batch_item_failures_metric(self.response, context)  # Line 368
    status_code = extract_http_status_code_tag(...)  # Line 370
```
→ **NO MATCH** - called at different point in execution flow

### Step 3: Make Your Decision

**PASS (1) if:**
- Functions imported in same files
- Functions called from same locations
- Calls happen at approximately the same point in execution flow
- Arguments passed are semantically the same

**FAIL (0) if:**
- Functions imported in different files
- Functions called from different locations
- Calls happen at significantly different points in flow
- Missing function calls from reference

---

## EXAMPLES

**PASS Example:**
```
Reference:
# wrapper.py, _after method, line 47-49
from datadog_lambda.metric import submit_batch_item_failures_metric
...
def _after(self, event, context):
    try:
        submit_batch_item_failures_metric(self.response, context)
        status_code = extract_http_status_code_tag(...)

Candidate:
# wrapper.py, _after method, line 47-49
from datadog_lambda.metric import submit_batch_item_failures_metric
...
def _after(self, event, context):
    try:
        submit_batch_item_failures_metric(self.response, context)
        status_code = extract_http_status_code_tag(...)
```
**Verdict**: PASS - same file, same method, same relative position

**FAIL Example:**
```
Reference:
# wrapper.py, _after method, line 296
submit_batch_item_failures_metric(self.response, context)
status_code = extract_http_status_code_tag(...)

Candidate:
# wrapper.py, _after method, line 368 (different location)
cold_start_trace(...)
submit_batch_item_failures_metric(self.response, context)
status_code = extract_http_status_code_tag(...)
```
**Verdict**: FAIL - called at different point in execution (after cold_start_trace)

**PASS Example (Variable Names Don't Matter):**
```
Reference:
submit_batch_item_failures_metric(self.response, context)

Candidate:
lambda_response = self.response
lambda_ctx = context
submit_batch_item_failures_metric(lambda_response, lambda_ctx)
```
**Verdict**: PASS - different variable names but same values passed

---

## DECISION CRITERIA

Integration points should match because:
- Timing matters for metrics and side effects
- Call locations affect error handling and control flow
- Missing integrations mean features aren't activated
- Wrong locations can cause race conditions

Return JSON with 'score' (0 or 1) and detailed rationale listing all integration mismatches found.`;

export default createScore({
  prepare: async ({ evaluation }) => {
    try {
      const diff = await fetchComparisonDiff(evaluation);

      assert(
        diff.trim().length > 0,
        `Integration points score requires a non-empty reference diff for ${evaluation.repo}.`,
      );

      return diff;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Integration points reference diff preparation failed: ${message}`,
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
        rationale: `Integration points candidate diff generation failed: ${message}`,
      };
    }

    assert(
      typeof candidateDiff === "string" && candidateDiff.trim().length > 0,
      "Integration points score requires a diff to compare.",
    );
    assert(
      typeof reference === "string" && reference.length > 0,
      "Integration points score requires a reference diff to compare against.",
    );

    try {
      const { object } = await generateObject({
        model: judge.model,
        schema: scoreResultSchema,
        system: systemPrompt,
        temperature: 0,
        prompt: `Reference diff:\n${reference}\n\nCandidate diff:\n${candidateDiff}\n\nCompare ONLY the integration points (imports, function calls, call locations, timing). Ignore implementation details. Respond with JSON.`,
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Integration points evaluation failed: ${message}`,
      };
    }
  },
});
