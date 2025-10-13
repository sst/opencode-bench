import { strict as assert } from "node:assert";

import { z } from "zod";

import type { DatasetEval } from "~/lib/dataset.js";
import type { Judge } from "~/lib/judgeTypes.js";

export const scoreResultSchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().min(1)
});

export interface ScorePreparationContext<Config = unknown> {
  evaluation: DatasetEval;
  cwd: string;
  config: Config;
}

export interface ScoreEvaluationContext<Reference, Config = unknown> {
  evaluation: DatasetEval;
  cwd: string;
  config: Config;
  judge: Judge;
  reference: Reference;
}

export interface ScoreResult {
  score: number;
  rationale: string;
}

export interface ScoreHooks<Reference, Config = unknown> {
  prepare?: (
    context: ScorePreparationContext<Config>,
  ) => Reference | Promise<Reference>;
  evaluate: (
    context: ScoreEvaluationContext<Reference, Config>,
  ) => ScoreResult | Promise<ScoreResult>;
}

export interface ScoreDefinition<Reference = unknown, Config = unknown> {
  prepare(context: ScorePreparationContext<Config>): Promise<Reference>;
  evaluate(
    context: ScoreEvaluationContext<Reference, Config>,
  ): Promise<ScoreResult>;
}

export function createScore<Reference = unknown, Config = unknown>(
  hooks: ScoreHooks<Reference, Config>,
): ScoreDefinition<Reference, Config> {
  const prepareHook =
    hooks.prepare ??
    (async () => undefined as Reference);

  return {
    async prepare(
      context: ScorePreparationContext<Config>,
    ): Promise<Reference> {
      return prepareHook(context);
    },
    async evaluate(
      context: ScoreEvaluationContext<Reference, Config>,
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
