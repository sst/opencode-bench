#!/usr/bin/env bun
import process from "node:process";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Agent } from "~/agents/index.js";
import { scores as scoreRegistry } from "~/scores/index.js";
import { Eval } from "~/evals/index.js";
import {
  generateActionsSummary,
  type EpisodeActions,
} from "~/lib/summarizer.js";
import { judges, getJudgeModelId } from "~/judges.js";
import { aggregateScores } from "~/lib/utils/scoreAggregation.js";
import type { Judge } from "~/lib/judgeTypes.js";
import type {
  AggregationSummary,
  ScoreAggregationInput,
} from "~/lib/utils/scoreAggregation.js";
import type { Episode, EvaluationRunExport, Usage } from "~/types/export.js";
import { withRetries } from "~/lib/utils/retry.js";
import { buildRadarChartUrl } from "~/lib/charts.js";
import { Logger } from "./lib/logger.js";

type ModelCombination = string;

const cli = yargs(hideBin(process.argv))
  .scriptName("orvl")
  .wrap(null)
  .version(false)
  .help("help", "show help")
  .alias("help", "h")
  .example([
    [
      "$0 opencode --model opencode/gpt-5-codex --eval DataDog/datadog-lambda-python@93d4a07..d776378",
    ],
    [
      "$0 opencode --model opencode/claude-sonnet-4-5 --eval DataDog/datadog-lambda-python@93d4a07..d776378 --output results.json",
    ],
  ])
  .fail((msg) => {
    console.error(msg);
    process.exit(1);
  })
  .strict();

cli.command(
  "generate",
  "Generate dataset for all evaluations",
  async (yargs) =>
    yargs.example([["orvl generate", "Generate dataset for all evaluations"]]),
  async ({ eval: evalId }) => {
    const logger = Logger.create();
    logger.log(`Generating dataset...`);

    await Eval.generate({ logger });
  },
);

cli.command(
  "$0 [agent]",
  "Run benchmark evaluation",
  async (yargs) =>
    yargs
      .positional("agent", {
        type: "string",
        description: "agent to use",
        choices: Agent.list().map((agent) => agent.name),
        required: true,
      })
      .option("model", {
        type: "string",
        description: "model to use in the format of provider/model",
        required: true,
      })
      .option("eval", {
        type: "string",
        description: "eval to use in the format of repo@from..to",
        required: true,
      })
      .option("episodes", {
        type: "number",
        description: "number of episodes to run",
        min: 1,
        default: 3,
      })
      .option("timeout", {
        type: "number",
        description: "timeout in minutes for each episode",
        default: 40,
      })
      .option("output", {
        type: "string",
        description: "output file to save the results to",
      }),
  async ({
    agent: agentName,
    model: modelFilter,
    eval: evalId,
    episodes,
    timeout: timeoutMins,
    output: outputPath,
  }) => {
    const evals = await Eval.load();
    const agent = getAgent(agentName);
    const model = getModel(agent, modelFilter);
    const evalDef = getEval(evals, evalId);
    const logger = Logger.create(`[model ${model}]`);

    // Run episodes
    const settled = await Promise.allSettled(
      Array.from({ length: episodes }, (_, offset) => {
        const index = offset + 1;
        const childLogger = logger.child(`[episode ${index}/${episodes}]`);
        childLogger.log(`Starting episode with ${timeoutMins}min timeout...`);
        return withRetries(
          () => runEpisode(evalDef, agent, model, childLogger),
          {
            retries: 3,
            timeoutMs: timeoutMins * 60 * 1000,
            logger: childLogger,
          },
        ).then((result) => ({ index, ...result }));
      }),
    );

    // TODO
    console.log(JSON.stringify(settled, null, 2));

    const results = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .sort((a, b) => a.index - b.index);

    if (results.length < episodes) {
      throw new Error(
        logger.format(`Only ${results.length}/${episodes} episodes succeeded`),
      );
    }

    // Merge results
    let totalDuration = 0;
    const averageUsage = { input: 0, output: 0, cost: 0 };
    const aggregatedInputs = new Map<string, ScoreAggregationInput>();
    const episodeExports: Episode[] = [];
    const episodesActions: EpisodeActions[] = [];
    results.forEach((result) => {
      totalDuration += result.duration;
      episodeExports.push({
        finalScore: result.aggregationSummary.finalScore,
        baseScore: result.aggregationSummary.baseScore,
        variancePenalty: result.aggregationSummary.variancePenalty,
        scores: result.scoreExports,
        usage: result.usage,
      });
      episodesActions.push({
        episodeIndex: result.index,
        actions: result.actions,
      });
      averageUsage.input += result.usage.input / results.length;
      averageUsage.output += result.usage.output / results.length;
      averageUsage.cost += result.usage.cost / results.length;

      for (const input of result.aggregation.values()) {
        const entry = ensureAggregationEntry(
          aggregatedInputs,
          input.assignment,
        );
        entry.judgeResults.push(...input.judgeResults);
      }
    });

    // Generate summary from all episodes' actions
    const summary = await generateActionsSummary(
      evalDef,
      model,
      episodesActions,
    );

    const evaluationResult = summarizeAggregation(
      agent.name,
      evalDef,
      model,
      aggregatedInputs,
      episodeExports,
      averageUsage,
      summary,
      totalDuration,
    );

    printEvalResult(episodeExports, evaluationResult, logger);
    buildEvalChart(evaluationResult, logger);
    storeEvalResult(evaluationResult, outputPath, logger);
  },
);

try {
  await cli.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Cleanup all loaded agents
  const agents = Agent.list();
  for (const agent of agents) {
    if (agent.definition.cleanup) {
      await agent.definition.cleanup();
    }
  }
  process.exit();
}

function getAgent(agentName?: string) {
  const agent = agentName ? Agent.get(agentName) : undefined;
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);
  return agent;
}

function getModel(agent: Agent.Registration, modelFilter: string) {
  const model = agent.models.find((entry) => entry === modelFilter);
  if (!model)
    throw new Error(
      `Model ${modelFilter} is not registered for agent ${agent.name}.`,
    );
  return model;
}

function getEval(evals: Eval.Instance[], evalId: string) {
  const evalDef = evals.find((ev) => ev.id === evalId);
  if (!evalDef) throw new Error(`Eval ${evalId} was not found.`);
  if (!evalDef.scores.length)
    throw new Error(
      `Evaluation ${evalDef.repo} has no score assignments configured.`,
    );
  return evalDef;
}

async function runEpisode(
  ev: Eval.Instance,
  agent: Agent.Registration,
  model: string,
  logger: Logger.Instance,
) {
  const cwd = mkdtempSync(join(tmpdir(), "openreval-"));

  // validate prompts
  if (ev.prompts.length === 0)
    throw new Error(`No prompts found in ${ev.prompts} for ${ev.repo}.`);

  try {
    logger.log(`Cloning repository...`);
    cloneRepositoryAtCommit(cwd, ev.repo, ev.from);

    const preparedScores = new Map<string, unknown>();
    for (const score of ev.scores) {
      const scoreDefinition = scoreRegistry[score.name];
      if (!scoreDefinition)
        throw new Error(
          logger.format(`Score ${score.name} is not registered.`),
        );

      try {
        const prepared = await scoreDefinition.prepare({
          ev: ev,
          cwd,
          config: score.args,
          logger,
        });
        preparedScores.set(score.name, prepared);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          logger.format(`Failed to prepare score ${score.name}: ${message}`),
        );
      }
    }

    logger.log(`Running tasks...`);
    let duration = 0;
    const usage = { input: 0, output: 0, cost: 0 };
    const episodeActions: string[] = [];

    for (const prompt of ev.prompts) {
      const childLogger = logger.child(
        `[prompt ${ev.repo.split("/")[1]}@${prompt.commit.slice(0, 7)}]`,
      );

      try {
        const startedAt = Date.now();
        const result = await agent.definition.run(model, prompt.prompt, cwd!, {
          logger: childLogger,
        });
        duration += Date.now() - startedAt;

        // Only accumulate usage from the successful result
        usage.input += result.usage.input;
        usage.output += result.usage.output;
        usage.cost += result.usage.cost;

        // Collect actions from this task
        episodeActions.push(...result.actions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          childLogger.format(
            `Agent run failed for planner task ${prompt.commit}: ${message}`,
          ),
        );
      }
    }

    logger.log(`Scoring...`);
    // Even if no changes were written, continue to scoring so judges can
    // compare the untouched baseline against the desired target.

    const episodeAggregation = await collectAggregationInputsForRun(
      ev,
      model,
      cwd,
      preparedScores,
      logger,
    );

    if (episodeAggregation.size === 0) {
      throw new Error(
        logger.format(`No score results were produced for this episode.`),
      );
    }

    const aggregationSummary = aggregateScores(
      Array.from(episodeAggregation.values()),
    );

    const episodeScoreExports = buildScoreExportsFromAggregation(
      episodeAggregation,
      aggregationSummary,
    );

    logger.log(
      `Episode completed with final score ${aggregationSummary.finalScore.toFixed(
        3,
      )} (base ${aggregationSummary.baseScore.toFixed(
        3,
      )} - variance penalty ${aggregationSummary.variancePenalty.toFixed(3)})`,
    );

    return {
      aggregation: episodeAggregation,
      aggregationSummary,
      scoreExports: episodeScoreExports,
      actions: episodeActions,
      usage,
      duration,
    };
  } finally {
    cleanupRepository(cwd, logger);
  }
}

function printEvalResult(
  episodes: Episode[],
  evalExport: ReturnType<typeof summarizeAggregation>,
  logger: Logger.Instance,
) {
  evalExport.lines.forEach(logger.log);

  if (!evalExport.exportData) return;

  const formatEpisode = (final: number, base: number, penalty: number) =>
    `final ${final.toFixed(3)} (base ${base.toFixed(
      3,
    )} - penalty ${penalty.toFixed(3)})`;

  logger.log(
    "Episode recap:",
    ...episodes.map(
      (episode, i) =>
        `  Episode ${i + 1}: ${formatEpisode(
          episode.finalScore,
          episode.baseScore,
          episode.variancePenalty,
        )}`,
    ),
    `Aggregate final: ${formatEpisode(
      evalExport.exportData.finalScore,
      evalExport.exportData.baseScore,
      evalExport.exportData.variancePenalty,
    )}`,
  );
}

function buildEvalChart(
  evalExport: ReturnType<typeof summarizeAggregation>,
  logger: Logger.Instance,
) {
  const chartUrl = buildRadarChartUrl({
    labels: evalExport.exportData.scores.map((s) => s.assignment.name),
    values: evalExport.exportData.scores.map((s) =>
      Number(s.averageScore.toFixed(3)),
    ),
    title: `${evalExport.exportData.evaluation.repo} • ${evalExport.exportData.model}`,
    datasetLabel: evalExport.exportData.model,
  });
  logger.log(`Radar Chart: ${chartUrl}\n`);
}

function storeEvalResult(
  evalExport: ReturnType<typeof summarizeAggregation>,
  outputPath: string | undefined,
  logger: Logger.Instance,
) {
  if (!outputPath) return;

  try {
    const directory = dirname(outputPath);
    if (directory && directory !== ".") {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(outputPath, JSON.stringify(evalExport.exportData, null, 2));
  } catch (error) {
    throw new Error(
      logger.format(`Failed to write export to ${outputPath}:`, error),
    );
  }
}

function cloneRepositoryAtCommit(cwd: string, repo: string, commitSha: string) {
  const opts = { cwd, stdio: "ignore" as const };
  execSync(`git init`, opts);
  execSync(`git remote add origin https://github.com/${repo}.git`, opts);
  execSync(`git fetch --depth 1 origin ${commitSha}`, opts);
  execSync(`git checkout --detach FETCH_HEAD`, opts);
  execSync(`git reset --hard FETCH_HEAD`, opts);
}

function cleanupRepository(cwd: string, logger: Logger.Instance): void {
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch (e) {
    logger.error(
      `Failed to clean up temporary repo:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function collectAggregationInputsForRun(
  ev: Eval.Instance,
  model: ModelCombination,
  cwd: string,
  preparedReferences: Map<string, unknown>,
  logger: Logger.Instance,
): Promise<Map<string, ScoreAggregationInput>> {
  const aggregationInputs = new Map<string, ScoreAggregationInput>();

  for (const judge of judges) {
    for (const assignment of ev.scores) {
      const scoreDefinition = scoreRegistry[assignment.name];

      if (!scoreDefinition) {
        logger.error(
          `Score ${assignment.name} is not registered (model ${model}).`,
        );
        continue;
      }

      if (!preparedReferences.has(assignment.name)) {
        logger.error(
          `Score ${assignment.name} did not provide prepared references for model ${model}.`,
        );
        continue;
      }

      const reference = preparedReferences.get(assignment.name);

      try {
        const result = await scoreDefinition.evaluate({
          judge,
          reference,
          ev: ev,
          cwd,
          config: assignment.args,
          logger,
        });

        ensureAggregationEntry(aggregationInputs, assignment).judgeResults.push(
          {
            judge,
            score: result.score,
            rationale: result.rationale,
          },
        );
      } catch (error) {
        const rationale =
          error instanceof Error
            ? error.message
            : "Unknown error during score evaluation.";

        ensureAggregationEntry(aggregationInputs, assignment).judgeResults.push(
          {
            judge,
            score: 0,
            rationale,
          },
        );
      }
    }
  }

  return aggregationInputs;
}

function summarizeAggregation(
  agentName: string,
  ev: Eval.Instance,
  model: ModelCombination,
  aggregationInputs: Map<string, ScoreAggregationInput>,
  episodes: Episode[],
  usage: Usage,
  summary: string,
  duration: number,
) {
  const evalId = ev.repo;

  const aggregation = aggregateScores(Array.from(aggregationInputs.values()));

  const lines: string[] = [];
  lines.push(`\nScore breakdown for ${model} on ${evalId}:`);
  const formatRawWeight = (value: number): string => {
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return Number(value.toPrecision(6)).toString();
  };

  aggregation.perScore.forEach((entry) => {
    lines.push(
      `  ${entry.assignment.name} → ${entry.averageScore.toFixed(
        3,
      )} (weight ${formatRawWeight(
        entry.assignment.weight,
      )}, normalized ${entry.normalizedWeight.toFixed(3)})`,
    );
    const raw = aggregationInputs.get(entry.assignment.name);
    if (raw) {
      raw.judgeResults.forEach((result) => {
        lines.push(
          `    - ${result.judge.name}: ${result.score.toFixed(3)} → ${
            result.rationale
          }`,
        );
      });
    }
  });

  lines.push(
    `  Final aggregate score: ${aggregation.finalScore.toFixed(
      3,
    )} (base ${aggregation.baseScore.toFixed(
      3,
    )} - penalty ${aggregation.variancePenalty.toFixed(3)})\n`,
  );

  const scoreExports = buildScoreExportsFromEpisodes(episodes);

  const exportData: EvaluationRunExport = {
    agent: agentName,
    evaluation: {
      identifier: ev.id,
      repo: ev.repo,
      from: ev.from,
      to: ev.to,
    },
    model,
    jobUrl: process.env.GITHUB_BENCHMARK_JOB_URL!,
    finalScore: aggregation.finalScore,
    baseScore: aggregation.baseScore,
    variancePenalty: aggregation.variancePenalty,
    scores: scoreExports,
    usage,
    summary,
    duration,
  };

  return { lines, exportData };
}

function buildScoreExportsFromAggregation(
  aggregationInputs: Map<string, ScoreAggregationInput>,
  aggregationSummary: AggregationSummary,
): EvaluationRunExport["scores"] {
  return aggregationSummary.perScore.map((entry) => {
    const raw = aggregationInputs.get(entry.assignment.name);
    const judges =
      raw?.judgeResults.map((result) => ({
        name: result.judge.name,
        model: getJudgeModelId(result.judge.name),
        score: result.score,
        rationale: result.rationale,
      })) ?? [];

    return {
      assignment: {
        name: entry.assignment.name,
        weight: entry.assignment.weight,
        args: entry.assignment.args,
      },
      averageScore: entry.averageScore,
      normalizedWeight: entry.normalizedWeight,
      variance: entry.variance,
      judges,
    };
  });
}

function buildScoreExportsFromEpisodes(
  episodes: Episode[],
): EvaluationRunExport["scores"] {
  if (episodes.length === 0) {
    return [];
  }

  const aggregationInputs = new Map<string, ScoreAggregationInput>();

  episodes.forEach((episode) => {
    episode.scores.forEach((score) => {
      const entry = ensureAggregationEntry(aggregationInputs, score.assignment);

      score.judges.forEach((judgeResult) => {
        const judge: Judge = {
          name: judgeResult.name as Judge["name"],
          model: judgeResult.model,
        };

        entry.judgeResults.push({
          judge,
          score: judgeResult.score,
          rationale: judgeResult.rationale,
        });
      });
    });
  });

  const summary = aggregateScores(Array.from(aggregationInputs.values()));
  return buildScoreExportsFromAggregation(aggregationInputs, summary);
}

function ensureAggregationEntry(
  map: Map<string, ScoreAggregationInput>,
  assignment: Eval.Instance["scores"][number],
): ScoreAggregationInput {
  if (!map.has(assignment.name)) {
    map.set(assignment.name, {
      assignment,
      judgeResults: [],
    });
  }

  // Non-null assertion safe because we just set it if missing.
  return map.get(assignment.name)!;
}
