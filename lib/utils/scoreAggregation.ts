import { strict as assert } from "node:assert";

import type { Judge } from "~/lib/judgeTypes.js";
import type { Eval } from "~/evals/index.js";

/*
  Formulas (mirrors README explanation):
    averageScore_j = (1 / |valid_j|) * Σ score_{judge,j}
    normalizedWeight_j = weight_j / Σ weight_k
    variance_j = Σ w_i (score_{i,j} - averageScore_j)^2  with uniform judge weights w_i
    finalScore = baseScore - λ Σ normalizedWeight_j * variance_j
*/
export interface JudgeScoreResult {
  judge: Judge;
  score: number;
  rationale: string;
}

export interface ScoreAggregationInput {
  assignment: Eval.Instance["scores"][number];
  judgeResults: JudgeScoreResult[];
}

export interface AggregatedScore {
  assignment: Eval.Instance["scores"][number];
  averageScore: number;
  normalizedWeight: number;
  variance: number;
}

export interface AggregationSummary {
  perScore: AggregatedScore[];
  finalScore: number;
  baseScore: number;
  variancePenalty: number;
}

const DEFAULT_DISAGREEMENT_PENALTY = 0.5;

export function averageJudgeScore(judgeResults: JudgeScoreResult[]): number {
  const { averageScore } = computeJudgeStatistics(judgeResults);
  return averageScore;
}

interface JudgeStatistics {
  averageScore: number;
  variance: number;
  judgeCount: number;
}

function computeJudgeStatistics(
  judgeResults: JudgeScoreResult[],
): JudgeStatistics {
  const validScores = judgeResults
    .map((result) => result.score)
    .filter(
      (score): score is number =>
        typeof score === "number" && Number.isFinite(score),
    );

  const judgeCount = validScores.length;

  if (judgeCount === 0) {
    return { averageScore: 0, variance: 0, judgeCount: 0 };
  }

  const averageScore =
    validScores.reduce((sum, score) => sum + score, 0) / judgeCount;

  assert(
    Number.isFinite(averageScore) && averageScore >= 0 && averageScore <= 1,
    "Average judge score must be between 0 and 1.",
  );

  const uniformWeight = 1 / judgeCount;
  const variance = validScores.reduce((sum, score) => {
    const diff = score - averageScore;
    return sum + uniformWeight * diff * diff;
  }, 0);

  return { averageScore, variance, judgeCount };
}

export function normalizeWeight(weight: number, totalWeight: number): number {
  const denominator = totalWeight === 0 ? 1 : totalWeight;
  return weight / denominator;
}

export function aggregateScores(
  inputs: ScoreAggregationInput[],
  options?: { disagreementPenalty?: number },
): AggregationSummary {
  if (inputs.length === 0) {
    return { perScore: [], finalScore: 0, baseScore: 0, variancePenalty: 0 };
  }

  const totalWeight =
    inputs.reduce((sum, { assignment }) => sum + assignment.weight, 0) ||
    inputs.length;
  const penaltyLambda =
    options?.disagreementPenalty ?? DEFAULT_DISAGREEMENT_PENALTY;

  const perScore = inputs.map(({ assignment, judgeResults }) => {
    const { averageScore, variance } = computeJudgeStatistics(judgeResults);
    const normalizedWeight = normalizeWeight(assignment.weight, totalWeight);

    return {
      assignment,
      averageScore,
      normalizedWeight,
      variance,
    } satisfies AggregatedScore;
  });

  const baseScore = weightedSum(perScore);
  const weightedVariance = perScore.reduce(
    (sum, entry) => sum + entry.normalizedWeight * entry.variance,
    0,
  );
  const variancePenalty = penaltyLambda * weightedVariance;
  const finalScore = Math.max(0, baseScore - variancePenalty);

  return { perScore, finalScore, baseScore, variancePenalty };
}

export function weightedSum(entries: AggregatedScore[]): number {
  if (entries.length === 0) {
    return 0;
  }

  return entries.reduce(
    (sum, entry) => sum + entry.averageScore * entry.normalizedWeight,
    0,
  );
}
