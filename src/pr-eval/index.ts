import { z } from "zod";
import { generateObject } from "ai";
import { Logger } from "../util/logger.js";
import { Judge } from "../judges.js";
import { getZenLanguageModel } from "../zenModels.js";
import { average, variance, weightedSum } from "../util/math.js";
import { fetchPrContext, type PrEvalContext } from "./fetcher.js";
import { PrCriteria } from "./criteria/index.js";

export namespace PrEval {
  export const DISAGREEMENT_PENALTY = 0.5;

  export interface JudgeScore {
    judge: string;
    score: number;
    rationale: string;
  }

  export interface CriterionResult {
    criterion: string;
    displayName: string;
    weight: number;
    average: number;
    variance: number;
    judges: JudgeScore[];
  }

  export type Recommendation = "approved" | "rejected" | "needs-review";

  export interface EvaluationResult {
    prUrl: string;
    owner: string;
    repo: string;
    prNumber: number;
    finalScore: number;
    baseScore: number;
    penalty: number;
    recommendation: Recommendation;
    criteria: CriterionResult[];
    evaluatedAt: string;
  }

  function getRecommendation(score: number): Recommendation {
    if (score >= 70) return "approved";
    if (score >= 50) return "needs-review";
    return "rejected";
  }

  export function getConsensusLevel(variance: number): "high" | "medium" | "low" {
    if (variance < 100) return "high";
    if (variance < 400) return "medium";
    return "low";
  }

  export async function evaluate(
    prUrl: string,
    opts: { logger: Logger.Instance },
  ): Promise<EvaluationResult> {
    opts.logger.log(`Fetching PR data from ${prUrl}...`);
    const context = await fetchPrContext(prUrl);

    opts.logger.log(
      `PR: ${context.owner}/${context.repo}#${context.prNumber} - "${context.title}"`,
    );
    opts.logger.log(
      `Stats: ${context.diffStats.filesChanged} files, +${context.diffStats.additions}/-${context.diffStats.deletions} lines`,
    );

    const allScores: CriterionResult[] = [];

    for (const criterionName of PrCriteria.names) {
      const config = PrCriteria.all[criterionName];
      const cl = opts.logger.child(`[${config.displayName}]`);

      cl.log("Evaluating...");

      const scores: JudgeScore[] = [];
      for (const judge of Judge.all) {
        const jl = cl.child(`[${judge}]`);
        jl.log("Judging...");

        try {
          const result = await judgeScore(
            config.criterion.systemPrompt,
            config.criterion.createUserPrompt(context),
            judge,
            { logger: jl },
          );
          scores.push({ judge, ...result });
          jl.log(`Score: ${result.score}/100`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          jl.error(`Failed: ${msg}`);
          scores.push({ judge, score: 0, rationale: `Error: ${msg}` });
        }
      }

      const avg = average(scores.map((s) => s.score));
      const vrc = variance(
        avg,
        scores.map((s) => s.score),
      );

      allScores.push({
        criterion: criterionName,
        displayName: config.displayName,
        weight: config.weight,
        average: avg,
        variance: vrc,
        judges: scores,
      });

      cl.log(`Average: ${avg.toFixed(1)}/100 (variance: ${vrc.toFixed(1)})`);
    }

    // Calculate weighted average (scores are 0-100)
    const weightedAvg = weightedSum(
      allScores.map(({ average, weight }) => ({ value: average, weight })),
    );

    // Calculate weighted variance for penalty
    const weightedVrc = weightedSum(
      allScores.map(({ variance, weight }) => ({ value: variance, weight })),
    );

    // Apply penalty (scaled for 0-100 range)
    const penalty = DISAGREEMENT_PENALTY * Math.sqrt(weightedVrc);
    const finalScore = Math.max(0, Math.min(100, weightedAvg - penalty));

    opts.logger.log(`Final Score: ${finalScore.toFixed(1)}/100`);
    opts.logger.log(`Recommendation: ${getRecommendation(finalScore)}`);

    return {
      prUrl,
      owner: context.owner,
      repo: context.repo,
      prNumber: context.prNumber,
      finalScore,
      baseScore: weightedAvg,
      penalty,
      recommendation: getRecommendation(finalScore),
      criteria: allScores,
      evaluatedAt: new Date().toISOString(),
    };
  }

  async function judgeScore(
    systemPrompt: string,
    userPrompt: string,
    judge: string,
    opts: { logger: Logger.Instance },
  ): Promise<{ score: number; rationale: string }> {
    const { object } = await generateObject({
      model: getZenLanguageModel(judge),
      schema: z.object({
        score: z
          .number()
          .min(0)
          .max(100)
          .describe("Score from 0 to 100"),
        rationale: z.string().min(1).describe("Explanation of the score"),
      }),
      system: systemPrompt,
      temperature: 0,
      prompt: userPrompt,
    });

    if (!object || typeof object !== "object") {
      throw new Error("Judge must return an object.");
    }
    if (typeof object.score !== "number" || object.score < 0 || object.score > 100) {
      throw new Error("Judge must return a score between 0 and 100.");
    }
    if (typeof object.rationale !== "string" || object.rationale.length === 0) {
      throw new Error("Judge must include a rationale.");
    }

    return { score: object.score, rationale: object.rationale };
  }
}
