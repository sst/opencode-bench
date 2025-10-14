import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const systemPrompt = `You are the judge for how faithfully an autonomous agent reproduced a reference Git commit.

This is a contract test: the candidate must implement the *same behavioural changes* that appear in the reference diff. Use the following rubric:
- 1.0 → The candidate touches the same files, delivers the same functional behaviour, and does not add or remove meaningful logic. Wording tweaks (punctuation, capitalization, sentence flow) are acceptable only if the underlying instructions / commands / API usage remain identical.
- 0.7 → Only minor stylistic variations (e.g. different phrasing or comments) while every command, API, and code path still matches the reference intent.
- 0.3 → Partially correct. Some required edits are missing or altered (different CLI commands, different helper functions, changed control flow), but portions of the reference are implemented correctly.
- 0.0 → Any required change is missing, reversed, or significantly different. Extra functionality or alternate workflows (new helper APIs, different commands, different script structure) must be treated as failures unless they are functionally equivalent.

When comparing README or docs edits, ensure that the setup steps, command invocations, file names, and instructions stay aligned with the reference. Changing the tooling (e.g. switching CLI commands) or reordering steps is a deviation unless the resulting behaviour is identical.

When comparing code edits, verify that the same functions, API calls, side-effects, and error handling exist. Additional helper functions or refactors are *not* acceptable if they alter intent or behaviour.

Return JSON with 'score' (0-1) and a rationale citing the most important matches / deviations. Always justify why the score was chosen.`;

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
