import type { ScoreDefinition } from "~/lib/createScore.js";

import semanticSimilarity from "~/scores/semantic-similarity.js";

// TODO: Restore UI score when implementation returns.
// TODO: Restore code-quality score when implementation returns.

export const scores: Record<string, ScoreDefinition> = {
  "semantic-similarity": semanticSimilarity
};

export function getScore(name: string): ScoreDefinition | undefined {
  return scores[name];
}

export function listScores(): string[] {
  return Object.keys(scores);
}
