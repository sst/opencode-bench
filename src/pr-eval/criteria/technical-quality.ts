import type { PrEvalContext } from "../fetcher.js";

export const systemPrompt = `You are evaluating whether a GitHub Pull Request demonstrates TECHNICAL QUALITY suitable for a coding benchmark.

**YOUR ROLE**: Assess if this PR touches meaningful code and has proper testing, making it suitable for evaluating AI coding agents.

IMPORTANT: You must give a score from 0-100. Be strict but fair.

---

## WHAT TO EVALUATE

### Code Meaningfulness:
1. **Substance over style**
   - NOT just formatting/linting changes
   - NOT just dependency updates or version bumps
   - Contains actual logic changes (conditionals, functions, data flow)

2. **Technical depth**
   - Involves decision-making (conditionals, algorithms, data structures)
   - Requires understanding of the codebase patterns
   - Has technical challenge (not just boilerplate)

3. **Real-world relevance**
   - Represents actual production work
   - Not a toy example or demo
   - Solves a real problem or adds real functionality

### Test Infrastructure:
1. **Test coverage**
   - Adds or modifies tests alongside code changes
   - Tests are meaningful (not just mocks or stubs)
   - Tests verify the actual behavioral change

2. **Test executability**
   - Tests can be run independently
   - Clear test framework in use (pytest, jest, go test, etc.)
   - Tests don't require complex external setup

3. **Verification potential**
   - Changes can be verified programmatically
   - Success criteria is testable (not subjective)
   - Can determine pass/fail objectively

---

## SCORING RUBRIC

**90-100**: Excellent technical quality
- Significant logic changes with clear technical depth
- Comprehensive test additions or modifications
- Clear verification path through automated tests
- Production-ready, non-trivial implementation

**70-89**: Good technical quality
- Meaningful code changes with some complexity
- Some test coverage included
- Reasonable verification possible
- Real functionality added/modified

**50-69**: Moderate technical quality
- Some meaningful changes mixed with trivial ones
- Limited or no test coverage
- Verification might be challenging
- Borderline complexity

**30-49**: Limited technical quality
- Mostly trivial or cosmetic changes
- Little to no test coverage
- Hard to verify correctness
- Minimal technical challenge

**0-29**: Poor technical quality
- Only formatting, config, or dependency changes
- No tests whatsoever
- No clear verification method
- No real logic changes

---

Return JSON with 'score' (0-100) and 'rationale' explaining your assessment.`;

export function createUserPrompt(context: PrEvalContext): string {
  const filesPreview = context.files
    .slice(0, 30)
    .map((f) => `  - ${f.filename} (${f.status}, ${f.changes} changes)`)
    .join("\n");

  const diffPreview =
    context.diff.length > 8000
      ? context.diff.slice(0, 8000) + "\n... [diff truncated for evaluation]"
      : context.diff;

  return `Evaluate this Pull Request for TECHNICAL QUALITY as a benchmark task candidate.

## PR Information

**Title:** ${context.title}
**Repository:** ${context.owner}/${context.repo}

## PR Description

${context.body || "(No description provided)"}

## Statistics

- Files changed: ${context.diffStats.filesChanged}
- Lines added: ${context.diffStats.additions}
- Lines deleted: ${context.diffStats.deletions}
- Contains test files: ${context.hasTests ? "Yes" : "No"}

## Files Changed

${filesPreview}
${context.files.length > 30 ? `... and ${context.files.length - 30} more files` : ""}

## Full Diff

\`\`\`diff
${diffPreview}
\`\`\`
${context.diffTruncated ? "\n(Note: Diff was truncated due to size)" : ""}

Based on the above, evaluate the TECHNICAL QUALITY of this PR:
1. Does it contain meaningful logic changes (not just formatting/config)?
2. Does it include or modify tests?
3. Can the changes be verified programmatically?
4. Is there sufficient technical depth for a benchmark task?`;
}
