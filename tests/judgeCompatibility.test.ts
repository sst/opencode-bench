import { describe, expect, it } from "bun:test";
import { generateObject } from "ai";

import { scoreResultSchema, type ScoreResult } from "~/lib/createScore.js";
import { judges } from "~/judges.js";
import type { Judge } from "~/lib/judgeTypes.js";
import {
  systemPrompt as logicEquivalencePrompt,
  createUserPrompt as createLogicEquivalencePrompt,
} from "~/scores/logic-equivalence.js";

/**
 * Judge Compatibility Tests
 *
 * These tests verify that all configured judges (claude-4.5, gpt-5-codex, kimi)
 * can successfully evaluate diffs and return valid scores.
 *
 * This is a smoke test to ensure:
 * - All judge models are properly configured
 * - All judges can process the same instructions
 * - All judges return valid binary scores (0 or 1)
 *
 * Note: This does NOT test consistency - see judgeConsistency*.test.ts for that.
 */

// Simple test case for compatibility testing
const testDiff = {
  reference: `diff --git a/src/handler.py b/src/handler.py
index 1234567..abcdefg 100644
--- a/src/handler.py
+++ b/src/handler.py
@@ -1,5 +1,5 @@
 def process(data):
-    if data is None:
+    if data is None or len(data) == 0:
         return False
     return True`,
  candidate: `diff --git a/src/handler.py b/src/handler.py
index 1234567..abcdefg 100644
--- a/src/handler.py
+++ b/src/handler.py
@@ -1,5 +1,5 @@
 def process(data):
-    if data is None:
+    if data is None or len(data) == 0:
         return False
     return True`,
};

async function evaluateWithJudge(
  judge: Judge,
  systemPrompt: string,
  userPrompt: string,
): Promise<ScoreResult> {
  const { object } = await generateObject({
    model: judge.model,
    schema: scoreResultSchema,
    system: systemPrompt,
    temperature: 0,
    prompt: userPrompt,
  });

  return object;
}

describe("Judge Compatibility Tests", () => {
  judges.forEach((judge) => {
    it(`${judge.name} should successfully evaluate a diff and return a valid score`, async () => {
      const userPrompt = createLogicEquivalencePrompt(
        testDiff.reference,
        testDiff.candidate,
      );

      const result = await evaluateWithJudge(
        judge,
        logicEquivalencePrompt,
        userPrompt,
      );

      // Verify score is valid binary value
      expect([0, 1]).toContain(result.score);

      // Verify rationale is provided
      expect(result.rationale).toBeDefined();
      expect(result.rationale.length).toBeGreaterThan(0);

      console.log(`\n${judge.name}: Score=${result.score}`);
    }, 120000); // 2 minute timeout per judge
  });

  it("all judges should be accessible", () => {
    expect(judges.length).toBe(3);
    expect(judges[0].name).toBe("claude-4.5");
    expect(judges[1].name).toBe("gpt-5-codex");
    expect(judges[2].name).toBe("kimi");
  });
});
