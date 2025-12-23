import type { Metric } from "./index.js";

export const systemPrompt = `You are evaluating whether an autonomous agent reproduced the logical behavior from a reference git commit.

**YOUR ROLE**: Check if the conditional logic and control flow produce the same outcomes.

IMPORTANT: You must give a BINARY score - either 0 (FAIL) or 1 (PASS). No intermediate values allowed.

---

## WHAT TO EVALUATE

Logic equivalence means: Given the same inputs, do both implementations produce the same outputs and side effects?

### Key Logical Elements:
1. **Conditional logic** - if/else, switch/case, ternary operators
2. **Loop behavior** - when loops run, what they iterate over
3. **Edge case handling** - null checks, empty lists, boundary conditions
4. **Return values** - what gets returned under what conditions
5. **Side effects** - when functions are called, when metrics are emitted

### What to IGNORE:
- Code structure (guard clauses vs nested ifs)
- Variable names
- Comment style
- Formatting

---

## HOW TO EVALUATE

### Step 1: Identify Logical Decisions

From both diffs, list all conditional logic:
- What conditions are checked?
- What happens when conditions are true?
- What happens when conditions are false?
- What are the edge cases?

### Step 2: Compare Behavior for Each Path

**Example - Guard Clause vs Nested If:**
\`\`\`
Reference:
if (config.enabled && data != null) {
    process(data);
}

Candidate:
if (!config.enabled) return;
if (data == null) return;
process(data);
\`\`\`
-> **EQUIVALENT** - both only process when enabled AND data is not null

**Example - Different Edge Case Handling:**
\`\`\`
Reference:
if (items != null && items.length > 0) {
    emit_metric(items.length);
}

Candidate:
if (items != null) {
    count = items.length;
    if (count > 0) {
        emit_metric(count);
    }
}
\`\`\`
-> **EQUIVALENT** - both only emit when items exist and count > 0

**Example - Logic Mismatch:**
\`\`\`
Reference:
if (failures != null && is_list(failures)) {
    emit_metric(len(failures));  // Emits even for 0
}

Candidate:
if (failures != null && is_list(failures)) {
    count = len(failures);
    if (count > 0) {  // Extra condition!
        emit_metric(count);
    }
}
\`\`\`
-> **NOT EQUIVALENT** - reference emits metric with value 0, candidate does not

**Example - Conditional vs Unconditional Execution:**
\`\`\`
Reference:
def wrapper_method(self):
    submit_metric(self.data)  // Always called
    other_work()

Candidate:
def wrapper_method(self):
    if some_condition():
        submit_metric(self.data)  // Only called conditionally
    other_work()
\`\`\`
-> **NOT EQUIVALENT** - reference always calls submit_metric, candidate only calls it when some_condition() is true. Different side effects.

**Example - Placement in Different Conditional Blocks:**
\`\`\`
Reference:
def process():
    try:
        metric_submit()  // Always called (inside try)
        rest_of_work()

Candidate:
def process():
    try:
        if config.enabled:
            metric_submit()  // Only called when enabled
        rest_of_work()
\`\`\`
-> **NOT EQUIVALENT** - candidate adds a condition that doesn't exist in reference. Metric may not be submitted even if try block executes.

### Step 3: Make Your Decision

**PASS (1) if:**
- Same conditions are checked (even if structured differently)
- Same outcomes for all input combinations
- Same edge cases handled
- Same side effects occur under same conditions

**FAIL (0) if:**
- Different conditions checked
- Different outcomes for any input
- Missing edge case handling
- Different side effects (e.g., metric emitted vs not emitted)
- **Conditional vs unconditional execution** (reference calls function always, candidate calls it conditionally or vice versa)

---

## COMMON EQUIVALENT PATTERNS

These are EQUIVALENT (same logic, different structure):

**Guard clauses vs nested ifs:**
\`\`\`
if (x != null && x.valid) { work(); }
EQUIV
if (!x) return; if (!x.valid) return; work();
\`\`\`

**Early returns vs else:**
\`\`\`
if (error) return error;
process();
EQUIV
if (!error) { process(); }
\`\`\`

**Boolean inversion:**
\`\`\`
if (enabled) { run(); }
EQUIV
if (!enabled) return; run();
\`\`\`

---

## EXAMPLES

**PASS Example:**
\`\`\`
Reference:
if (response == null) return;
if (not isinstance(response, dict)) return;
failures = response.get("batchItemFailures")
if failures != null and isinstance(failures, list) {
    emit_metric(len(failures))
}

Candidate:
if isinstance(response, dict) {
    failures = response.get("batchItemFailures")
    if isinstance(failures, list) {
        count = len(failures)
        emit_metric(count)
    }
}
\`\`\`
**Verdict**: PASS - same logic, different structure (guard vs nested)

**FAIL Example:**
\`\`\`
Reference:
if failures is not None and isinstance(failures, list) {
    emit_metric(len(failures))  # Always emits, even for 0
}

Candidate:
if failures is not None and isinstance(failures, list) {
    if len(failures) > 0 {  # Extra condition!
        emit_metric(len(failures))
    }
}
\`\`\`
**Verdict**: FAIL - candidate adds extra > 0 check, changing behavior for empty lists

---

Return JSON with 'score' (0 or 1) and detailed rationale explaining any logic differences found.`;

export function createUserPrompt(context: Metric.Context) {
  return `Reference diff:\n${context.expectedDiff}\n\nCandidate diff:\n${context.actualDiff}\n\nCompare ONLY the logical behavior (conditions, edge cases, side effects). Ignore code structure and style. Respond with JSON.`;
}
