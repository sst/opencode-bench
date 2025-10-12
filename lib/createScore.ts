import { strict as assert } from "node:assert";

import type { Judge } from "~/lib/judgeTypes.js";

export interface ScoreContext {
  diff: string;
  referenceDiff: string;
  judge: Judge;
}

export interface ScoreResult {
  score: number;
  rationale: string;
}

export type ScoreEvaluator = (context: ScoreContext) => ScoreResult | Promise<ScoreResult>;

export interface ScoreDefinition {
  evaluate: (context: ScoreContext) => Promise<ScoreResult>;
}

export function createScore(evaluator: ScoreEvaluator): ScoreDefinition {
  return {
    async evaluate(context: ScoreContext): Promise<ScoreResult> {
      const raw = await evaluator(context);
      assert(raw && typeof raw === "object", "Score evaluators must return an object.");
      const { score, rationale } = raw as Partial<ScoreResult>;
      assert(
        typeof score === "number" && Number.isFinite(score),
        "Score evaluators must return a finite number between 0 and 1."
      );
      assert(
        typeof rationale === "string" && rationale.length > 0,
        "Score evaluators must include a rationale string."
      );

      const clamped = Math.min(Math.max(score, 0), 1);
      assert(clamped === score, "Score evaluators must clamp results between 0 and 1.");

      return { score, rationale };
    }
  };
}
