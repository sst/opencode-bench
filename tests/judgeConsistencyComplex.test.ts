import { describe, expect, it } from "bun:test";
import { generateObject } from "ai";

import { scoreResultSchema, type ScoreResult } from "~/lib/createScore.js";
import { judges } from "~/judges.js";
import type { Judge } from "~/lib/judgeTypes.js";
import { systemPrompt as logicEquivalencePrompt } from "~/scores/logic-equivalence.js";
import type { DiffPair } from "./fixtures/judgeConsistencyFixtures.js";
import {
  logicEquivalenceComplexFixtures,
  testCoverageComplexFixtures,
} from "./fixtures/judgeConsistencyFixturesComplex.js";

/**
 * High Complexity Judge Consistency Tests
 *
 * These tests verify that judges handle very complex scenarios:
 * - Architectural refactors (class → function)
 * - Cross-cutting concerns (logging added everywhere)
 * - Async refactoring (sync → async)
 *
 * These tests are more intensive and should be run before releases.
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
  scoreType: "logic-equivalence",
): string {
  const { reference, candidate } = diffPair;
  return `Reference diff:\n${reference}\n\nCandidate diff:\n${candidate}\n\nCompare ONLY the logical behavior (conditions, edge cases, side effects). Ignore code structure and style. Respond with JSON.`;
}

async function testConsistency(
  judge: Judge,
  systemPrompt: string,
  diffPair: DiffPair,
  scoreType: "logic-equivalence",
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

describe("Judge Consistency Tests - High Complexity", () => {
  describe("Logic Equivalence Score - Complex", () => {
    it("should consistently score perfect matches (architectural refactor) as 1 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceComplexFixtures.perfect,
        "logic-equivalence",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 1)).toBe(true);

      console.log("\nComplex - Logic Perfect Match (Refactor) Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 180000); // 3 minute timeout for complex scenarios

    it("should consistently score wrong implementations (missing cross-cutting) as 0 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceComplexFixtures.wrong,
        "logic-equivalence",
        3,
      );

      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 0)).toBe(true);

      console.log("\nComplex - Logic Wrong Implementation (Missing Logging) Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 180000);

    it("should be consistent on ambiguous cases (sync → async) (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceComplexFixtures.ambiguous,
        "logic-equivalence",
        3,
      );

      const scores = results.map((r) => r.score);
      const uniqueScores = new Set(scores);
      expect(uniqueScores.size).toBe(1);

      const consistentScore = scores[0];
      console.log(`\nComplex - Logic Ambiguous (Async Refactor): Consistent score = ${consistentScore}`);
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}`);
      });
    }, 180000);
  });

  // Note: Test Coverage tests would go here once test-coverage.ts exports systemPrompt
  // For now, these are placeholder for future expansion
  describe.skip("Test Coverage Score - Complex", () => {
    it("placeholder for test coverage consistency tests", async () => {
      // Will be implemented when test-coverage judge is ready
      expect(true).toBe(true);
    });
  });
});
