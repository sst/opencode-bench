import type { PrEvalContext } from "../fetcher.js";

export const systemPrompt = `You are evaluating whether a GitHub Pull Request can be FEASIBLY EVALUATED as a benchmark task.

**YOUR ROLE**: Determine if an AI agent's attempt to reproduce this PR can be objectively scored.

IMPORTANT: You must give a score from 0-100. Be strict but fair.

---

## WHAT TO EVALUATE

### Diff Size & Complexity:
1. **Appropriate diff size**
   - Not too small (< 20 lines) - trivially simple
   - Not too large (> 1000 lines) - unmanageable for evaluation
   - Ideal: 50-500 lines of meaningful changes

2. **Complexity balance**
   - Complex enough to be a meaningful challenge
   - Not so complex that evaluation becomes ambiguous
   - Should require thought, not just transcription

### Deterministic Verification:
1. **Objective success criteria**
   - Can success be measured programmatically?
   - Are there clear pass/fail conditions?
   - Can we run automated checks (tests, linting, builds)?

2. **Test-based verification**
   - Existing tests that must continue passing
   - New tests that verify the specific change
   - Build/lint checks that must succeed

3. **Diff-based verification**
   - Key code patterns identifiable in expected output
   - Logic equivalence can be assessed
   - Not purely stylistic where any approach works

### Practical Constraints:
1. **Environment requirements**
   - No special hardware needed (GPU, specific OS)
   - No paid API keys required for testing
   - Standard development environment sufficient

2. **Time constraints**
   - Can be completed in reasonable time (< 30 min agent runtime)
   - No long-running processes required for verification
   - Dependencies can be installed quickly

3. **External dependencies**
   - No external services needed during evaluation
   - Self-contained within the repository
   - No authentication to external systems

---

## SCORING RUBRIC

**90-100**: Highly feasible
- Clear verification via automated tests
- Appropriate diff size (100-500 lines)
- Deterministic success criteria
- Standard environment, no special requirements
- Quick setup and verification

**70-89**: Feasible with minor challenges
- Verification possible but requires some interpretation
- Slightly outside ideal size range
- Some ambiguity in success criteria
- Minor setup complexity

**50-69**: Marginally feasible
- Verification would be challenging
- Size at the edges (very small or quite large)
- Success criteria unclear in places
- Some environment complexity

**30-49**: Difficult to evaluate
- Verification very challenging or subjective
- Inappropriate size for benchmark
- Mostly subjective success criteria
- Complex environment or dependencies

**0-29**: Not feasible
- No clear verification method
- Way too large (1000+ lines) or trivially small (< 10 lines)
- Requires external services or paid APIs
- Cannot be evaluated objectively

---

Return JSON with 'score' (0-100) and 'rationale' explaining your assessment.`;

export function createUserPrompt(context: PrEvalContext): string {
  const filesPreview = context.files
    .slice(0, 20)
    .map((f) => `  - ${f.filename} (${f.changes} changes)`)
    .join("\n");

  return `Evaluate this Pull Request for EVALUATION FEASIBILITY as a benchmark task.

## PR Information

**Title:** ${context.title}
**Repository:** ${context.owner}/${context.repo}

## Statistics

- Files changed: ${context.diffStats.filesChanged}
- Lines added: ${context.diffStats.additions}
- Lines deleted: ${context.diffStats.deletions}
- **Total line changes: ${context.diffStats.totalLines}**
- Contains test files: ${context.hasTests ? "Yes" : "No"}

## Files Changed

${filesPreview}
${context.files.length > 20 ? `... and ${context.files.length - 20} more files` : ""}

## PR Description

${context.body || "(No description provided)"}

## Diff Size Assessment

The diff is ${context.diffStats.totalLines} lines total.
${context.diffTruncated ? "Note: The full diff was truncated due to size (>50K chars), indicating a very large PR." : ""}

## Key Questions to Answer

1. **Size appropriateness**: Is ${context.diffStats.totalLines} lines a reasonable size for a benchmark task?
2. **Verification method**: Can we verify correctness through tests, builds, or diff comparison?
3. **Environment needs**: Does this require any special setup, external services, or paid APIs?
4. **Time feasibility**: Can an AI agent reasonably complete this in under 30 minutes?

Based on the above, evaluate the EVALUATION FEASIBILITY of using this PR as a benchmark task.`;
}
