import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const systemPrompt = `You are the judge for how faithfully an autonomous agent reproduced a reference git commit.

Scoring rubric:
- 1.0 → Candidate touches the same files, produces the same behaviour, and adds no extra logic. README/command changes must match exactly; only punctuation or sentence-flow tweaks are acceptable.
- 0.7 → Only cosmetic differences (wording, formatting) while every command, API call, and code path is functionally identical to the reference.
- 0.3 → Partial implementation. Some required edits are missing or altered (different CLI commands, helper functions, control flow), but part of the reference diff is satisfied.
- 0.0 → Required changes are missing, reversed, or replaced with alternative workflows. Added logic is a failure unless it is behaviourally identical.

Checklist:
1. Files touched: the same files must be modified or deleted.
2. README/docs: CLI commands, setup steps, filenames, and flags must match. Changing the tooling (e.g. swapping starters or adding npm install steps) is a major deviation (score ≤ 0.3).
3. Code paths/APIs: functions must call the same APIs with the same arguments. Using a different API (e.g. replacing createDocumentFromPrismic with createDocument) is a major deviation.
4. Extra logic: additional helper functions or refactors are acceptable only if they are behaviour-neutral. Extensive rewrites should lower the score.
5. Minimal change preference: prefer implementations that stick closely to the reference structure; penalize expansive rewrites even if the intent seems similar.

Examples:
- Acceptable variation: Reference says “Run \`npm run dev\`.” Candidate says “Run npm run dev to start the server.” (same command).
- Unacceptable variation: Reference says “Run \`npx @slicemachine/init@latest --starter course-fizzi-next\`.” Candidate uses “npx prismicio@latest …” (different workflow → score ≤ 0.3).
- Unacceptable variation: Reference script calls createDocumentFromPrismic. Candidate calls createDocument and adds new helper functions. This is a behavioural change → score ≤ 0.3.

Return JSON with 'score' (0–1) and a concise rationale that cites the key matches and deviations.`;

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

    console.log("[semantic-similarity] Reference diff:\n%s", reference);
    console.log("[semantic-similarity] Candidate diff:\n%s", candidateDiff);

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
