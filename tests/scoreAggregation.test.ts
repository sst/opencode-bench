import { describe, expect, it } from "bun:test";

import {
  aggregateScores,
  averageJudgeScore,
  normalizeWeight,
  weightedSum,
  type ScoreAggregationInput,
} from "~/lib/utils/scoreAggregation.js";
import type { ScoreAssignment } from "~/lib/dataset.js";
import type { Judge, JudgeName } from "~/lib/judgeTypes.js";

/*
  Formulas under test (documented in README):
    averageScore_j = (1 / |valid_j|) * Σ score_{judge,j}
    normalizedWeight_j = weight_j / Σ weight_k
    variance_j = Σ w_i (score_{i,j} - averageScore_j)^2 with uniform judge weights w_i
    finalScore = baseScore - λ Σ normalizedWeight_j * variance_j
*/
const createJudge = (name: JudgeName): Judge => ({
  name,
  model: name as unknown as Judge["model"],
});

describe("aggregateScores", () => {
  it("averages judge scores per assignment", () => {
    const judgeResults = [
      { judge: createJudge("claude-4.5"), score: 0.8, rationale: "" },
      { judge: createJudge("gpt-5-codex"), score: 0.6, rationale: "" },
      { judge: createJudge("kimi"), score: 0.7, rationale: "" },
    ];

    expect(Number(averageJudgeScore(judgeResults).toFixed(3))).toEqual(0.7);
    expect(averageJudgeScore([])).toEqual(0);
  });

  it("normalizes weights correctly", () => {
    expect(normalizeWeight(4, 10)).toEqual(0.4);
    expect(normalizeWeight(3, 10)).toEqual(0.3);
    expect(normalizeWeight(0, 0)).toEqual(0);
  });

  it("computes weighted sum of scores", () => {
    const entries = [
      {
        assignment: { name: "ui", weight: 4 },
        averageScore: 0.8,
        normalizedWeight: 0.4,
        variance: 0,
      },
      {
        assignment: { name: "code-quality", weight: 3 },
        averageScore: 0.6,
        normalizedWeight: 0.3,
        variance: 0,
      },
      {
        assignment: { name: "integration-points", weight: 3 },
        averageScore: 0.7,
        normalizedWeight: 0.3,
        variance: 0,
      },
    ];

    expect(Number(weightedSum(entries).toFixed(3))).toEqual(0.71);
    expect(weightedSum([])).toEqual(0);
  });

  it("computes weighted final score according to README formula", () => {
    const assignments: ScoreAssignment[] = [
      { name: "ui", weight: 4 },
      { name: "code-quality", weight: 3 },
      { name: "integration-points", weight: 3 },
    ];

    const judges = [
      createJudge("claude-4.5"),
      createJudge("gpt-5-codex"),
      createJudge("kimi"),
    ];

    const scoreMatrix = [
      [0.8, 0.6, 0.7],
      [0.9, 0.7, 0.6],
      [0.7, 0.5, 0.8],
    ];

    const inputs: ScoreAggregationInput[] = assignments.map(
      (assignment, assignmentIndex) => ({
        assignment,
        judgeResults: judges.map((judge, judgeIndex) => ({
          judge,
          score: scoreMatrix[judgeIndex][assignmentIndex],
          rationale: "",
        })),
      }),
    );

    const { perScore, finalScore, baseScore, variancePenalty } =
      aggregateScores(inputs);

    expect(
      perScore.map((entry) => Number(entry.averageScore.toFixed(3))),
    ).toEqual([0.8, 0.6, 0.7]);
    expect(perScore.map((entry) => Number(entry.variance.toFixed(6)))).toEqual([
      0.006667, 0.006667, 0.006667,
    ]);

    const normalizedWeights = perScore.map((entry) => entry.normalizedWeight);
    expect(
      Number(
        normalizedWeights.reduce((sum, weight) => sum + weight, 0).toFixed(6),
      ),
    ).toEqual(1);

    expect(Number(baseScore.toFixed(3))).toEqual(0.71);
    expect(Number(variancePenalty.toFixed(6))).toEqual(0.003333);
    expect(Number(finalScore.toFixed(3))).toEqual(0.707);
  });

  it("returns zero scores when no judge results are available", () => {
    const assignments: ScoreAssignment[] = [
      { name: "ui", weight: 1 },
      { name: "code-quality", weight: 1 },
    ];

    const inputs: ScoreAggregationInput[] = assignments.map((assignment) => ({
      assignment,
      judgeResults: [],
    }));

    const { perScore, finalScore, baseScore, variancePenalty } =
      aggregateScores(inputs);

    perScore.forEach((entry) => {
      expect(entry.averageScore).toEqual(0);
      expect(entry.variance).toEqual(0);
    });
    expect(finalScore).toEqual(0);
    expect(baseScore).toEqual(0);
    expect(variancePenalty).toEqual(0);
  });
});
