import type { ScoreDefinition } from "~/lib/createScore.js";

import apiSignature from "~/scores/api-signature.js";
import logicEquivalence from "~/scores/logic-equivalence.js";
import integrationPoints from "~/scores/integration-points.js";
import testCoverage from "~/scores/test-coverage.js";
import checks from "~/scores/checks.js";

export const scores: Record<string, ScoreDefinition<any, any>> = {
  "api-signature": apiSignature,
  "logic-equivalence": logicEquivalence,
  "integration-points": integrationPoints,
  "test-coverage": testCoverage,
  checks,
};

export function getScore(name: string): ScoreDefinition | undefined {
  return scores[name];
}

export function listScores(): string[] {
  return Object.keys(scores);
}
