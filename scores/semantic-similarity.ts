import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";
import { z } from "zod";

import { createScore } from "~/lib/createScore.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const similaritySchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

const systemPrompt = `You are scoring how well an autonomous agent replicated a reference diff.
The agent was instructed to implement precisely the changes shown in the reference diff.
Compare the candidate diff to the reference and judge semantic similarity:
- Verify the same files change with equivalent intent and effect.
- Penalize missing, incorrect, or additional changes that deviate from the reference.
- Accept minor stylistic or wording variations when they preserve meaning.
Return JSON with keys 'score' (0-1) and 'rationale' explaining your judgement. Score 1 only when the candidate fulfills the reference requirements; score 0 when it fails to implement them.`;

export default createScore({
  prepare: ({ evaluation, cwd }) => {
    try {
      const diff = execSync(
        `git diff --unified=5 ${evaluation.from} ${evaluation.to}`,
        {
          cwd,
          encoding: "utf8",
        },
      );

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
    finalizeAgentChanges(evaluation, cwd);
    let candidateDiff: string;
    try {
      candidateDiff = execSync(
        `git diff --unified=5 ${evaluation.to} HEAD`,
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
        schema: similaritySchema,
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
