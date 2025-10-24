import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const systemPrompt = `You are evaluating whether an autonomous agent reproduced the test coverage from a reference git commit.

**YOUR ROLE**: Check if all test scenarios are present and test the same behaviors.

IMPORTANT: You must give a BINARY score - either 0 (FAIL) or 1 (PASS). No intermediate values allowed.

---

## WHAT TO EVALUATE

Test coverage means: Are all the scenarios from the reference tests also tested in the candidate?

### Key Test Elements:
1. **Test scenarios** - what situations are being tested (happy path, errors, edge cases)
2. **Test assertions** - what outcomes are being verified
3. **Mock/stub setup** - what dependencies are mocked
4. **Test inputs** - what data is used for testing

### What to IGNORE:
- Test structure (class-based vs function-based)
- Test framework (unittest vs pytest vs jest)
- Mock library (unittest.mock vs pytest-mock)
- Test organization (file structure, grouping)
- Variable names in tests

---

## HOW TO EVALUATE

### Step 1: List All Test Scenarios

From both diffs, list each test and what it tests:
- Test name
- What scenario it covers
- What assertions it makes
- What inputs it uses

### Step 2: Compare Scenario Coverage

**Test Scenario Example:**
\`\`\`
Reference test_with_failures:
- Input: {"batchItemFailures": [{"id": "1"}, {"id": "2"}]}
- Assertion: metric called with value 2

Candidate test_with_failures:
- Input: {"batchItemFailures": [{"id": "1"}, {"id": "2"}, {"id": "3"}]}
- Assertion: metric called with value 3
\`\`\`
-> **MATCH** - same scenario (failures present), different data but same concept

**Missing Scenario Example:**
\`\`\`
Reference has:
- test_with_failures
- test_with_no_failures (empty list)
- test_with_no_field (field missing)
- test_with_null_response

Candidate has:
- test_with_failures
- test_with_no_field
- test_with_null_response
\`\`\`
-> **NO MATCH** - missing test_with_no_failures scenario

### Step 3: Compare Assertions

**Assertion Example:**
\`\`\`
Reference:
assert mock_metric.called_once_with("metric_name", 0, ...)

Candidate:
assert not mock_metric.called()
\`\`\`
-> **NO MATCH** - different assertions (expects call vs expects no call)

### Step 4: Make Your Decision

**PASS (1) if:**
- All test scenarios from reference are present in candidate
- Same assertions are made (even with different test syntax)
- Same behaviors are validated
- At least 90% of reference test coverage present

**FAIL (0) if:**
- Missing test scenarios from reference
- Different assertions (asserts 200 when reference asserts 404)
- Tests validate different behaviors
- Less than 90% of reference coverage

---

## EXAMPLES

**PASS Example:**
\`\`\`
Reference (unittest):
class TestBatchFailures(unittest.TestCase):
    def test_with_failures(self):
        response = {"batchItemFailures": [{"id": "1"}]}
        submit_metric(response, ctx)
        self.assert_called_once()

Candidate (pytest):
def test_with_failures():
    response = {"batchItemFailures": [{"id": "1"}]}
    submit_metric(response, ctx)
    assert mock_called_once()
\`\`\`
**Verdict**: PASS - same scenario, different test framework

**FAIL Example:**
\`\`\`
Reference has 6 tests:
1. test_with_failures
2. test_with_no_failures (empty list)
3. test_with_no_field
4. test_with_null_response
5. test_with_invalid_type
6. test_with_metrics_disabled

Candidate has 5 tests:
1. test_with_failures
2. test_with_no_field
3. test_with_null_response
4. test_with_invalid_type
5. test_with_metrics_disabled

Missing: test_with_no_failures
\`\`\`
**Verdict**: FAIL - missing test scenario for empty list

**FAIL Example (Different Assertion):**
\`\`\`
Reference test_empty_list:
response = {"batchItemFailures": []}
submit_metric(response, ctx)
assert_called_with("metric", 0, ...)  // Expects metric with value 0

Candidate test_empty_list:
response = {"batchItemFailures": []}
submit_metric(response, ctx)
assert_not_called()  // Expects NO metric call
\`\`\`
**Verdict**: FAIL - tests same scenario but expects different outcome

---

## DECISION CRITERIA

Test coverage should match because:
- Missing tests mean bugs won't be caught
- Different assertions mean different expected behaviors
- Edge cases need consistent handling
- Regression tests protect against future breaks

Return JSON with 'score' (0 or 1) and detailed rationale listing all missing scenarios or assertion mismatches.`;

export default createScore({
  prepare: async ({ evaluation }) => {
    try {
      const diff = await fetchComparisonDiff(evaluation);

      assert(
        diff.trim().length > 0,
        `Test coverage score requires a non-empty reference diff for ${evaluation.repo}.`,
      );

      return diff;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Test coverage reference diff preparation failed: ${message}`,
      );
    }
  },
  evaluate: async ({ evaluation, cwd, judge, reference }) => {
    finalizeAgentChanges(evaluation, cwd, evaluation.from);
    let candidateDiff: string;
    try {
      candidateDiff = execSync(`git diff --unified=5 ${evaluation.from} HEAD`, {
        cwd,
        encoding: "utf8",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Test coverage candidate diff generation failed: ${message}`,
      };
    }

    assert(
      typeof candidateDiff === "string" && candidateDiff.trim().length > 0,
      "Test coverage score requires a diff to compare.",
    );
    assert(
      typeof reference === "string" && reference.length > 0,
      "Test coverage score requires a reference diff to compare against.",
    );

    try {
      const { object } = await generateObject({
        model: judge.model,
        schema: scoreResultSchema,
        system: systemPrompt,
        temperature: 0,
        prompt: `Reference diff:\n${reference}\n\nCandidate diff:\n${candidateDiff}\n\nCompare ONLY the test coverage (test scenarios, assertions). Ignore test structure and framework. Respond with JSON.`,
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Test coverage evaluation failed: ${message}`,
      };
    }
  },
});
