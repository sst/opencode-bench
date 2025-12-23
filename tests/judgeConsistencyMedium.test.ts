import { describe, expect, it } from "bun:test";
import { generateObject } from "ai";

import { scoreResultSchema, type ScoreResult } from "~/lib/createScore.js";
import { judges } from "~/lib/judges.js";
import type { Judge } from "~/lib/judgeTypes.js";
import {
  systemPrompt as logicEquivalencePrompt,
  createUserPrompt as createLogicEquivalencePrompt,
} from "~/metrics/logic-equivalence.js";
import {
  systemPrompt as apiSignaturePrompt,
  createUserPrompt as createApiSignaturePrompt,
} from "~/scores/api-signature.js";
import {
  systemPrompt as integrationPointsPrompt,
  createUserPrompt as createIntegrationPointsPrompt,
} from "~/metrics/integration-points.js";
import type { DiffPair } from "./fixtures/judgeConsistencyFixtures.js";
import {
  logicEquivalenceMediumFixtures,
  apiSignatureMediumFixtures,
  integrationPointsMediumFixtures,
} from "./fixtures/judgeConsistencyFixturesMedium.js";

/**
 * Medium Complexity Judge Consistency Tests
 *
 * These tests verify that judges produce consistent scores on more complex scenarios:
 * - Nested loops with error handling
 * - State mutations across methods
 * - Multi-file API changes
 * - Import reorganizations
 *
 * All tests run 3 evaluations and verify consistency.
 */

async function evaluateWithJudge(
  judge: Judge,
  systemPrompt: string,
  userPrompt: string,
): Promise<ScoreResult> {
  try {
    const { object } = await generateObject({
      model: judge.model,
      schema: scoreResultSchema,
      system: systemPrompt,
      temperature: 0,
      prompt: userPrompt,
    });

    return object;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Judge evaluation failed: ${message}`);
  }
}

function createDiffComparisonPrompt(
  diffPair: DiffPair,
  scoreType: "logic-equivalence" | "api-signature" | "integration-points",
): string {
  const { reference, candidate } = diffPair;

  if (scoreType === "logic-equivalence") {
    return createLogicEquivalencePrompt(reference, candidate);
  } else if (scoreType === "api-signature") {
    return createApiSignaturePrompt(reference, candidate);
  } else {
    return createIntegrationPointsPrompt(reference, candidate);
  }
}

async function testConsistency(
  judge: Judge,
  systemPrompt: string,
  diffPair: DiffPair,
  scoreType: "logic-equivalence" | "api-signature" | "integration-points",
  runs: number = 3,
): Promise<ScoreResult[]> {
  const userPrompt = createDiffComparisonPrompt(diffPair, scoreType);

  const results = await Promise.all(
    Array.from({ length: runs }, () =>
      evaluateWithJudge(judge, systemPrompt, userPrompt),
    ),
  );

  return results;
}

const testJudge = judges[0];

describe("Judge Consistency Tests - Medium Complexity", () => {
  describe("Logic Equivalence Score - Medium", () => {
    it("should consistently score perfect matches (nested loops) as 1 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceMediumFixtures.perfect,
        "logic-equivalence",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 1)).toBe(true);

      console.log("\nMedium - Logic Perfect Match Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);

    it("should consistently score wrong implementations (state mutation bug) as 0 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceMediumFixtures.wrong,
        "logic-equivalence",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 0)).toBe(true);

      console.log("\nMedium - Logic Wrong Implementation Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);

    it("should be consistent on ambiguous cases (async vs callback) (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceMediumFixtures.ambiguous,
        "logic-equivalence",
        3,
      );

      const scores = results.map((r) => r.score);
      const uniqueScores = new Set(scores);
      expect(uniqueScores.size).toBe(1);

      const consistentScore = scores[0];
      console.log(
        `\nMedium - Logic Ambiguous: Consistent score = ${consistentScore}`,
      );
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);
  });

  describe("API Signature Score - Medium", () => {
    it("should consistently score perfect matches (multi-file) as 1 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        apiSignaturePrompt,
        apiSignatureMediumFixtures.perfect,
        "api-signature",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 1)).toBe(true);

      console.log("\nMedium - API Perfect Match Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);

    it("should consistently score wrong implementations (param order change) as 0 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        apiSignaturePrompt,
        apiSignatureMediumFixtures.wrong,
        "api-signature",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 0)).toBe(true);

      console.log("\nMedium - API Wrong Implementation Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);

    it("should be consistent on ambiguous cases (type annotations) (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        apiSignaturePrompt,
        apiSignatureMediumFixtures.ambiguous,
        "api-signature",
        3,
      );

      const scores = results.map((r) => r.score);
      const uniqueScores = new Set(scores);
      expect(uniqueScores.size).toBe(1);

      const consistentScore = scores[0];
      console.log(
        `\nMedium - API Ambiguous: Consistent score = ${consistentScore}`,
      );
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);
  });

  describe("Integration Points Score - Medium", () => {
    it("should consistently score perfect matches (import reorg) as 1 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        integrationPointsPrompt,
        integrationPointsMediumFixtures.perfect,
        "integration-points",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 1)).toBe(true);

      console.log("\nMedium - Integration Perfect Match Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);

    it("should consistently score wrong implementations (missing import) as 0 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        integrationPointsPrompt,
        integrationPointsMediumFixtures.wrong,
        "integration-points",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 0)).toBe(true);

      console.log("\nMedium - Integration Wrong Implementation Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);

    it("should be consistent on ambiguous cases (import alias) (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        integrationPointsPrompt,
        integrationPointsMediumFixtures.ambiguous,
        "integration-points",
        3,
      );

      const scores = results.map((r) => r.score);
      const uniqueScores = new Set(scores);
      expect(uniqueScores.size).toBe(1);

      const consistentScore = scores[0];
      console.log(
        `\nMedium - Integration Ambiguous: Consistent score = ${consistentScore}`,
      );
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 120000);
  });
});
