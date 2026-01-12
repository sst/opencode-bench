import type { PrEvalContext } from "../fetcher.js";

export const systemPrompt = `You are evaluating whether a GitHub Pull Request is suitable as a benchmark task based on SCOPE and CLARITY.

**YOUR ROLE**: Determine if this PR has clear, self-contained changes that could be reproduced as a coding task for evaluating AI coding agents.

IMPORTANT: You must give a score from 0-100. Be strict but fair.

---

## WHAT TO EVALUATE

### Scope Assessment:
1. **Self-containment** - Are the changes isolated and independent?
   - Does NOT depend on external PRs or uncommitted changes
   - Changes are localized to related files
   - No sprawling changes across unrelated modules

2. **Appropriate size** - Is the scope meaningful but not overwhelming?
   - Too small: Typo fixes, single-line config changes, version bumps
   - Too large: 50+ files, multiple unrelated features bundled together
   - Ideal: 3-30 files, single cohesive feature or fix

3. **Focused intent** - Does it solve ONE clear problem?
   - Single feature addition
   - Single bug fix
   - Single refactoring goal
   - NOT multiple unrelated changes bundled together

### Clarity Assessment:
1. **PR description quality** - Is the intent clear?
   - Explains WHAT is being changed
   - Explains WHY it's needed
   - Has clear acceptance criteria (explicit or implicit)

2. **Commit message quality** - Do commits tell a story?
   - Meaningful commit messages
   - Logical commit progression
   - Not just "fix" or "update"

3. **Code readability** - Can an AI agent understand the goal?
   - Changes are understandable without deep domain knowledge
   - Intent is clear from the diff itself
   - Not overly complex or cryptic

---

## SCORING RUBRIC

**90-100**: Excellent benchmark candidate
- Single, clear purpose evident from title and description
- Well-documented PR with context
- 3-20 files changed with focused changes
- Self-contained with no external dependencies
- Clear success criteria derivable from the PR

**70-89**: Good candidate with minor issues
- Clear purpose but could be better documented
- Slightly too large or too small
- Minor scope creep (1-2 unrelated changes)
- Most context is clear

**50-69**: Marginal candidate
- Purpose somewhat unclear
- Moderate scope issues (too broad or too narrow)
- Would need significant context to reproduce
- Description is sparse or confusing

**30-49**: Poor candidate
- Unclear purpose
- Too large (50+ files) or too fragmented
- Hard to understand intent from PR alone
- Multiple unrelated changes bundled

**0-29**: Not suitable
- No clear purpose or description
- Massive scope or trivially small
- Impossible to derive clear task
- Depends on external context unavailable

---

Return JSON with 'score' (0-100) and 'rationale' explaining your assessment.`;

export function createUserPrompt(context: PrEvalContext): string {
  const filesPreview = context.files
    .slice(0, 30)
    .map((f) => `  - ${f.filename} (${f.status}, ${f.changes} changes)`)
    .join("\n");

  const commitsPreview = context.commits
    .slice(0, 10)
    .map((c) => `  - ${c.message.split("\n")[0]}`)
    .join("\n");

  const diffPreview =
    context.diff.length > 5000
      ? context.diff.slice(0, 5000) + "\n... [diff truncated for evaluation]"
      : context.diff;

  return `Evaluate this Pull Request for SCOPE and CLARITY as a benchmark task candidate.

## PR Information

**Title:** ${context.title}
**Repository:** ${context.owner}/${context.repo}
**PR Number:** #${context.prNumber}
**Base Branch:** ${context.baseBranch} <- ${context.headBranch}

## PR Description

${context.body || "(No description provided)"}

## Statistics

- Files changed: ${context.diffStats.filesChanged}
- Lines added: ${context.diffStats.additions}
- Lines deleted: ${context.diffStats.deletions}
- Total commits: ${context.commits.length}

## Files Changed

${filesPreview}
${context.files.length > 30 ? `... and ${context.files.length - 30} more files` : ""}

## Commit Messages

${commitsPreview}
${context.commits.length > 10 ? `... and ${context.commits.length - 10} more commits` : ""}

## Diff Preview

\`\`\`diff
${diffPreview}
\`\`\`
${context.diffTruncated ? "\n(Note: Diff was truncated due to size)" : ""}

Based on the above, evaluate the SCOPE and CLARITY of this PR for use as a benchmark task.`;
}
