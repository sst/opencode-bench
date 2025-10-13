import { strict as assert } from "node:assert";

import type { DatasetEval } from "~/lib/dataset.js";
import type { Judge } from "~/lib/judgeTypes.js";

export interface ScorePreparationContext {
  evaluation: DatasetEval;
  cwd: string;
}

export interface ScoreEvaluationContext<Reference> {
  evaluation: DatasetEval;
  cwd: string;
  judge: Judge;
  reference: Reference;
}

export interface ScoreResult {
  score: number;
  rationale: string;
}

export interface ScoreHooks<Reference> {
  prepare?: (
    context: ScorePreparationContext,
  ) => Reference | Promise<Reference>;
  evaluate: (
    context: ScoreEvaluationContext<Reference>,
  ) => ScoreResult | Promise<ScoreResult>;
}

export interface ScoreDefinition<Reference = unknown> {
  prepare(context: ScorePreparationContext): Promise<Reference>;
  evaluate(context: ScoreEvaluationContext<Reference>): Promise<ScoreResult>;
}

export function createScore<Reference = unknown>(
  hooks: ScoreHooks<Reference>,
): ScoreDefinition<Reference> {
  const prepareHook =
    hooks.prepare ??
    (async () => undefined as Reference);

  return {
    async prepare(context: ScorePreparationContext): Promise<Reference> {
      return prepareHook(context);
    },
    async evaluate(
      context: ScoreEvaluationContext<Reference>,
    ): Promise<ScoreResult> {
      const raw = await hooks.evaluate(context);
      assert(
        raw && typeof raw === "object",
        "Score evaluators must return an object.",
      );
      const { score, rationale } = raw as Partial<ScoreResult>;
      assert(
        typeof score === "number" && Number.isFinite(score),
        "Score evaluators must return a finite number between 0 and 1.",
      );
      assert(
        typeof rationale === "string" && rationale.length > 0,
        "Score evaluators must include a rationale string.",
      );

      const clamped = Math.min(Math.max(score, 0), 1);
      assert(
        clamped === score,
        "Score evaluators must clamp results between 0 and 1.",
      );

      return { score, rationale };
    },
  };
}
