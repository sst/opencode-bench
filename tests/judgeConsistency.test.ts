import { describe, expect, it } from "bun:test";
import { generateObject } from "ai";

import { scoreResultSchema, type ScoreResult } from "~/lib/createScore.js";
import { judges } from "~/judges.js";
import type { Judge } from "~/lib/judgeTypes.js";
import { systemPrompt as logicEquivalencePrompt } from "~/scores/logic-equivalence.js";
import { systemPrompt as apiSignaturePrompt } from "~/scores/api-signature.js";
import {
  logicEquivalenceFixtures,
  apiSignatureFixtures,
  type DiffPair,
} from "./fixtures/judgeConsistencyFixtures.js";

/**
 * Judge Consistency Tests
 *
 * These tests ensure that judges produce consistent scores when evaluating
 * the same diffs multiple times. This is critical for:
 * - Detecting regressions when changing judge instructions
 * - Ensuring reliable evaluation results
 * - Building confidence in the scoring system
 *
 * Each test runs 3 evaluations of the same diff pair and verifies:
 * - Perfect matches: consistently score 1
 * - Clear mismatches: consistently score 0
 * - Ambiguous cases: consistent scores (either all 0s or all 1s)
 */

/**
 * Evaluate a diff pair directly using the judge's LLM.
 * This bypasses git operations and uses static diffs for consistency testing.
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

/**
 * Helper to create the user prompt for diff comparison.
 */
function createDiffComparisonPrompt(
  diffPair: DiffPair,
  scoreType: "logic-equivalence" | "api-signature",
): string {
  const { reference, candidate } = diffPair;

  if (scoreType === "logic-equivalence") {
    return `Reference diff:\n${reference}\n\nCandidate diff:\n${candidate}\n\nCompare ONLY the logical behavior (conditions, edge cases, side effects). Ignore code structure and style. Respond with JSON.`;
  } else {
    return `Reference diff:\n${reference}\n\nCandidate diff:\n${candidate}\n\nCompare ONLY the API signatures (function names, parameter order, parameter names). Ignore implementation details. Respond with JSON.`;
  }
}

/**
 * Run consistency test: evaluate the same diff pair N times and check results.
 */
async function testConsistency(
  judge: Judge,
  systemPrompt: string,
  diffPair: DiffPair,
  scoreType: "logic-equivalence" | "api-signature",
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

// Use the first judge (claude-4.5) for consistency testing
const testJudge = judges[0];

describe("Judge Consistency Tests", () => {
  describe("Logic Equivalence Score", () => {
    it("should consistently score perfect matches as 1 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceFixtures.perfect,
        "logic-equivalence",
        3,
      );

      // All scores should be 1
      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 1)).toBe(true);

      // Log rationales for debugging
      console.log("\nPerfect Match Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}, Rationale: ${r.rationale.substring(0, 100)}...`);
      });
    }, 120000); // 2 minute timeout for LLM calls

    it("should consistently score wrong implementations as 0 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceFixtures.wrong,
        "logic-equivalence",
        3,
      );

      // All scores should be 0
      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 0)).toBe(true);

      // Log rationales for debugging
      console.log("\nWrong Implementation Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}, Rationale: ${r.rationale.substring(0, 100)}...`);
      });
    }, 120000);

    it("should be consistent on ambiguous cases (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        logicEquivalencePrompt,
        logicEquivalenceFixtures.ambiguous,
        "logic-equivalence",
        3,
      );

      // All scores should be the same (either all 0s or all 1s)
      const scores = results.map((r) => r.score);
      const uniqueScores = new Set(scores);
      expect(uniqueScores.size).toBe(1);

      // Log what the consistent score was
      const consistentScore = scores[0];
      console.log(`\nAmbiguous Case: Consistent score = ${consistentScore}`);
      console.log("Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}, Rationale: ${r.rationale.substring(0, 100)}...`);
      });
    }, 120000);
  });

  describe("API Signature Score", () => {
    it("should consistently score perfect matches as 1 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        apiSignaturePrompt,
        apiSignatureFixtures.perfect,
        "api-signature",
        3,
      );

      // All scores should be 1
      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 1)).toBe(true);

      // Log rationales for debugging
      console.log("\nAPI Signature Perfect Match Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}, Rationale: ${r.rationale.substring(0, 100)}...`);
      });
    }, 120000);

    it("should consistently score wrong implementations as 0 (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        apiSignaturePrompt,
        apiSignatureFixtures.wrong,
        "api-signature",
        3,
      );

      // All scores should be 0
      const scores = results.map((r) => r.score);
      expect(scores.every((s) => s === 0)).toBe(true);

      // Log rationales for debugging
      console.log("\nAPI Signature Wrong Implementation Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}, Rationale: ${r.rationale.substring(0, 100)}...`);
      });
    }, 120000);

    it("should be consistent on ambiguous cases (3 runs)", async () => {
      const results = await testConsistency(
        testJudge,
        apiSignaturePrompt,
        apiSignatureFixtures.ambiguous,
        "api-signature",
        3,
      );

      // All scores should be the same (either all 0s or all 1s)
      const scores = results.map((r) => r.score);
      const uniqueScores = new Set(scores);
      expect(uniqueScores.size).toBe(1);

      // Log what the consistent score was
      const consistentScore = scores[0];
      console.log(`\nAPI Signature Ambiguous Case: Consistent score = ${consistentScore}`);
      console.log("Rationales:");
      results.forEach((r, i) => {
        console.log(`  Run ${i + 1}: Score=${r.score}, Rationale: ${r.rationale.substring(0, 100)}...`);
      });
    }, 120000);
  });
});
