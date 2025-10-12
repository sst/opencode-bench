import { strict as assert } from "node:assert";

import { generateObject } from "ai";
import { z } from "zod";

import { createScore } from "~/lib/createScore.js";

const similaritySchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

const systemPrompt = `You are an expert code reviewer assessing semantic similarity between two diffs.
Return a JSON object with keys \'score\' (0 to 1) and \'rationale\'.
Score of 1 means the diffs achieve the same changes; 0 means they are unrelated.`;

export default createScore(async ({ diff, referenceDiff, judge }) => {
  assert(
    typeof diff === "string" && diff.length > 0,
    "Semantic similarity score requires a diff to compare.",
  );
  assert(
    typeof referenceDiff === "string" && referenceDiff.length > 0,
    "Semantic similarity score requires a reference diff to compare against.",
  );

  try {
    const { object } = await generateObject({
      model: judge.model,
      schema: similaritySchema,
      system: systemPrompt,
      prompt: `Reference diff:\n${referenceDiff}\n\nCandidate diff:\n${diff}\n\nCompare the candidate changes against the reference expectations and respond with JSON.`,
    });

    return object;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      score: 0,
      rationale: `Semantic similarity evaluation failed: ${message}`,
    };
  }
});
