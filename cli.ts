#!/usr/bin/env bun
import process from "node:process";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { AgentRegistration, getAgent, listAgents } from "~/agents/index.js";
import { scores as scoreRegistry } from "~/scores/index.js";
import { dataset } from "~/lib/dataset.js";
import type { DatasetEval, ScoreAssignment } from "~/lib/dataset.js";
import { generatePromptsForEval, Task } from "~/lib/prompts.js";
import {
  generateActionsSummary,
  type EpisodeActions,
} from "~/lib/summarizer.js";
import { loadPromptsFile } from "~/lib/prompts.js";
import { judges, getJudgeModelId } from "~/judges.js";
import { aggregateScores } from "~/lib/utils/scoreAggregation.js";
import type { Judge } from "~/lib/judgeTypes.js";
import type {
  AggregationSummary,
  ScoreAggregationInput,
} from "~/lib/utils/scoreAggregation.js";
import type { Episode, EvaluationRunExport, Usage } from "~/types/export.js";
import { withRetries, withTimeout } from "~/lib/utils/retry.js";
import { buildRadarChartUrl } from "~/lib/charts.js";

type ModelCombination = string;

const evalIds = dataset
  .map((entry) => entry.identifier)
  .sort((a, b) => a.localeCompare(b));

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
  "prompts",
  "Generate prompts for a specific evaluation",
  (yargs) =>
    yargs
      .option("eval", {
        type: "string",
        description: "eval to use in the format of repo@from..to",
        choices: evalIds,
      })
      .example([
        ["orvl prompts", "Generate prompts for all evaluations"],
        [
          "orvl prompts --eval DataDog/datadog-lambda-python@93d4a07..d776378",
          "Generate prompts for a specific evaluation",
        ],
      ]),
  async ({ eval: evalId }) => {
    const evalDefs = (() => {
      if (!evalId) return [...dataset];
      const evalDef = dataset.find((entry) => entry.identifier === evalId);
      if (!evalDef) throw new Error(`Evaluation not found: ${evalId}`);
      return [evalDef];
    })();

    console.log(`Generating prompts for ${evalDefs.length} evaluation(s)...\n`);

    await Promise.all(evalDefs.map(generatePromptsForEval));
  },
);

cli.command(
  "$0 [agent]",
  "Run benchmark evaluation",
  (yargs) =>
    yargs
      .positional("agent", {
        type: "string",
        description: "agent to use",
        choices: listAgents().map((agent) => agent.name),
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
        choices: dataset.map((entry) => entry.identifier),
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
    timeout: timeoutInMinutes,
    output: outputPath,
  }) => {
    const agent = agentName ? await getAgent(agentName) : undefined;
    if (!agent) throw new Error(`Unknown agent: ${agentName}`);
    const model = agent.models.find((entry) => entry === modelFilter);
    if (!model)
      throw new Error(
        `Model ${modelFilter} is not registered for agent ${agent.name}.`,
      );
    const evalDef = dataset.find((entry) => entry.identifier === evalId);
    if (!evalDef) throw new Error(`Eval ${evalId ?? evalId} was not found.`);
    if (!evalDef.scores.length)
      throw new Error(
        `Evaluation ${evalDef.repo} has no score assignments configured.`,
      );

    const tasks = loadPromptsFile(evalDef.prompts);
    if (tasks.length === 0)
      throw new Error(
        `No prompts found in ${evalDef.prompts} for ${evalDef.repo}.`,
      );

    const combinationLabel = `${evalDef.repo} ${model}`;

    // Run episodes
    const episodeSettledResults = await Promise.allSettled(
      Array.from({ length: episodes }, (_, offset) =>
        withTimeout(
          async () => {
            const index = offset + 1;
            const prefix = `[episode ${index}/${episodes}] [${combinationLabel}]`;
            console.log(
              `${prefix} Starting episode (timeout: ${timeoutInMinutes} min)...`,
            );
            const result = await runEpisode(
              evalDef,
              agent,
              model,
              tasks,
              prefix,
            );
            return { index, ...result };
          },
          {
            timeoutMs: timeoutInMinutes * 60 * 1000,
            timeoutMessage: `Episode ${
              offset + 1
            } timed out after ${timeoutInMinutes} minutes`,
          },
        ),
      ),
    );

    const episodeResults = [];
    const episodeFailures = [];

    for (const [idx, settled] of episodeSettledResults.entries()) {
      if (settled.status === "fulfilled") {
        episodeResults.push(settled.value);
      } else {
        const errorMessage =
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
        episodeFailures.push(`Episode ${idx + 1} failed: ${errorMessage}`);
        console.error(`[episode ${idx + 1}/${episodes}] ${errorMessage}`);
      }
    }

    if (episodeResults.length < episodes) {
      throw new Error(
        `Expected ${episodes} episodes to complete, but only ${
          episodeResults.length
        } succeeded:\n${episodeFailures.join("\n")}`,
      );
    }

    episodeResults.sort((a, b) => a.index - b.index);

    const aggregatedInputs = new Map<string, ScoreAggregationInput>();
    const episodeExports: Episode[] = [];
    const allLogs: string[] = [];
    const episodesActions: EpisodeActions[] = [];
    const averageUsage = episodeResults.reduce(
      (prev, { usage }) => ({
        input: prev.input + usage.input / episodeResults.length,
        output: prev.output + usage.output / episodeResults.length,
      }),
      { input: 0, output: 0 },
    );

    for (const result of episodeResults) {
      mergeAggregationInputs(aggregatedInputs, result.aggregation);
      episodeExports.push({
        finalScore: result.aggregationSummary.finalScore,
        baseScore: result.aggregationSummary.baseScore,
        variancePenalty: result.aggregationSummary.variancePenalty,
        scores: result.scoreExports,
        usage: result.usage,
      });

      // Aggregate logs
      if (result.logs && result.logs.length > 0) {
        allLogs.push(...result.logs);
      }

      // Collect actions for summarization
      episodesActions.push({
        episodeIndex: result.index,
        actions: result.actions,
      });
    }

    // Generate summary from all episodes' actions
    let summary = "";
    try {
      summary = await generateActionsSummary(evalDef, model, episodesActions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${combinationLabel}] Failed to generate summary: ${message}`,
      );
      summary = ""; // Keep empty string on failure
    }

    const evaluationResult = summarizeAggregation(
      agent.name,
      evalDef,
      model,
      combinationLabel,
      aggregatedInputs,
      episodeExports,
      averageUsage,
      summary,
    );

    printEvalResult(evaluationResult);
    buildEvalChart(evaluationResult);
    storeEvalResult(evaluationResult, outputPath);
  },
);

try {
  await cli.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Cleanup all loaded agents
  const agents = listAgents();
  for (const agent of agents) {
    if (agent.definition.cleanup) {
      await agent.definition.cleanup();
    }
  }
  process.exit();
}

async function runEpisode(
  evalDef: DatasetEval,
  agent: AgentRegistration,
  model: string,
  tasks: Task[],
  prefix: string,
) {
  const baselineCommit = evalDef.from;
  let cwd: string | undefined;

  try {
    console.log(`${prefix} Cloning repository...`);
    cwd = cloneRepositoryAtCommit(evalDef, baselineCommit);

    const preparedScores = new Map<string, unknown>();
    for (const assignment of evalDef.scores) {
      const scoreDefinition = scoreRegistry[assignment.name];
      if (!scoreDefinition)
        throw new Error(
          `${prefix} Score ${assignment.name} is not registered.`,
        );

      try {
        const prepared = await scoreDefinition.prepare({
          evaluation: evalDef,
          cwd,
          config: assignment.args,
        });
        preparedScores.set(assignment.name, prepared);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${prefix} Failed to prepare score ${assignment.name}: ${message}`,
        );
      }
    }

    let tasksExecuted = 0;
    let usage: Usage = { input: 0, output: 0 };
    const episodeActions: string[] = [];

    for (const task of tasks) {
      const logPrefix = `${prefix} ${task.commit}`;

      try {
        const result = await withRetries(
          async () => {
            const result = await agent.definition.run(
              model,
              task.prompt,
              cwd!,
              {
                onStart: (commandString: string) => {
                  console.log(`${logPrefix} ${commandString.trim()}`);
                },
                logPrefix,
              },
            );
            return result;
          },
          {
            retries: 3,
            onRetry(error, attempt, retries) {
              const baseMessage =
                error instanceof Error ? error.message : String(error);
              console.error(
                `${logPrefix} Failed to render command for ${model} (attempt ${attempt}/${retries}): ${baseMessage}`,
              );

              if (attempt < retries) {
                console.log(
                  `${logPrefix} Retrying agent run (attempt ${
                    attempt + 1
                  }/${retries})...`,
                );
              }
            },
          },
        );

        // Only accumulate usage from the successful result
        usage.input += result.usage.input;
        usage.output += result.usage.output;

        // Collect actions from this task
        episodeActions.push(...result.actions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${prefix} Agent run failed for planner task ${task.commit}: ${message}`,
        );
      }

      tasksExecuted += 1;
    }

    if (tasksExecuted === 0) {
      throw new Error(`${prefix} No planner tasks have been executed.`);
    }

    // Even if no changes were written, continue to scoring so judges can
    // compare the untouched baseline against the desired target.

    const episodeAggregation = await collectAggregationInputsForRun(
      evalDef,
      model,
      cwd,
      preparedScores,
    );

    if (episodeAggregation.size === 0) {
      throw new Error(
        `${prefix} No score results were produced for this episode.`,
      );
    }

    const aggregationSummary = aggregateScores(
      Array.from(episodeAggregation.values()),
    );

    const episodeScoreExports = buildScoreExportsFromAggregation(
      episodeAggregation,
      aggregationSummary,
    );

    console.log(
      `${prefix} Episode completed with final score ${aggregationSummary.finalScore.toFixed(
        3,
      )} (base ${aggregationSummary.baseScore.toFixed(
        3,
      )} - variance penalty ${aggregationSummary.variancePenalty.toFixed(3)})`,
    );

    return {
      aggregation: episodeAggregation,
      aggregationSummary,
      scoreExports: episodeScoreExports,
      logs: [],
      actions: episodeActions,
      usage,
    };
  } finally {
    if (cwd) {
      cleanupRepository(cwd, evalDef);
    }
  }
}

function printEvalResult(evalExport: ReturnType<typeof summarizeAggregation>) {
  evalExport.lines.forEach(console.log);
  if (evalExport.exportData) {
    const { episodes, finalScore, baseScore, variancePenalty } =
      evalExport.exportData;
    if (episodes.length > 0) {
      console.log("[debug] Episode recap:");
      episodes.forEach((episode, index) => {
        console.log(
          `[debug]   Episode ${index + 1}: final ${episode.finalScore.toFixed(
            3,
          )} (base ${episode.baseScore.toFixed(
            3,
          )} - penalty ${episode.variancePenalty.toFixed(3)})`,
        );
      });
    }
    console.log(
      `[debug] Aggregate final: ${finalScore.toFixed(
        3,
      )} (base ${baseScore.toFixed(3)} - penalty ${variancePenalty.toFixed(
        3,
      )})`,
    );
  }
}

function buildEvalChart(evalExport: ReturnType<typeof summarizeAggregation>) {
  const chartUrl = buildRadarChartUrl({
    labels: evalExport.exportData.scores.map((s) => s.assignment.name),
    values: evalExport.exportData.scores.map((s) =>
      Number(s.averageScore.toFixed(3)),
    ),
    title: `${evalExport.exportData.evaluation.repo} • ${evalExport.exportData.model}`,
    datasetLabel: evalExport.exportData.model,
  });
  console.log(`\nRadar Chart: ${chartUrl}\n`);
}

function storeEvalResult(
  evalExport: ReturnType<typeof summarizeAggregation>,
  outputPath?: string,
) {
  if (!outputPath) return;

  try {
    const directory = dirname(outputPath);
    if (directory && directory !== ".") {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(outputPath, JSON.stringify(evalExport.exportData, null, 2));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error writing output.";
    throw new Error(`Failed to write export to ${outputPath}: ${message}`);
  }
}

function cleanupRepository(tempDir: string, entry: DatasetEval): void {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch (cleanupError) {
    console.error(
      `Failed to clean up temporary repo for ${entry.repo}:`,
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError),
    );
  }
}

function cloneRepositoryAtCommit(
  entry: DatasetEval,
  commitSha: string,
): string {
  const remoteUrl = `https://github.com/${entry.repo}.git`;
  const tempDir = mkdtempSync(join(tmpdir(), "openreval-"));

  try {
    execSync(`git init`, { cwd: tempDir, stdio: "ignore" });
    execSync(`git remote add origin ${remoteUrl}`, {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync(`git fetch --depth 1 origin ${commitSha}`, {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync(`git checkout --detach FETCH_HEAD`, {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync(`git reset --hard FETCH_HEAD`, {
      cwd: tempDir,
      stdio: "ignore",
    });

    return tempDir;
  } catch (error) {
    cleanupRepository(tempDir, entry);
    throw error;
  }
}

async function collectAggregationInputsForRun(
  datasetEval: DatasetEval,
  model: ModelCombination,
  cwd: string,
  preparedReferences: Map<string, unknown>,
): Promise<Map<string, ScoreAggregationInput>> {
  const aggregationInputs = new Map<string, ScoreAggregationInput>();

  for (const judge of judges) {
    for (const assignment of datasetEval.scores) {
      const scoreDefinition = scoreRegistry[assignment.name];

      if (!scoreDefinition) {
        console.error(
          `Score ${assignment.name} is not registered (model ${model}).`,
        );
        continue;
      }

      if (!preparedReferences.has(assignment.name)) {
        console.error(
          `Score ${assignment.name} did not provide prepared references for model ${model}.`,
        );
        continue;
      }

      const reference = preparedReferences.get(assignment.name);

      try {
        const result = await scoreDefinition.evaluate({
          judge,
          reference,
          evaluation: datasetEval,
          cwd,
          config: assignment.args,
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
  datasetEval: DatasetEval,
  model: ModelCombination,
  contextLabel: string | undefined,
  aggregationInputs: Map<string, ScoreAggregationInput>,
  episodes: Episode[],
  usage: Usage,
  summary: string,
): { lines: string[]; exportData: EvaluationRunExport } {
  const evalId = datasetEval.repo;
  const runContext = contextLabel ? `${evalId} [${contextLabel}]` : evalId;

  const aggregation = aggregateScores(Array.from(aggregationInputs.values()));

  const lines: string[] = [];
  lines.push(`\nScore breakdown for ${model} on ${runContext}:`);
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
      identifier: datasetEval.identifier,
      repo: datasetEval.repo,
      from: datasetEval.from,
      to: datasetEval.to,
    },
    model,
    jobUrl: process.env.GITHUB_BENCHMARK_JOB_URL!,
    finalScore: aggregation.finalScore,
    baseScore: aggregation.baseScore,
    variancePenalty: aggregation.variancePenalty,
    scores: scoreExports,
    episodes,
    usage,
    summary,
  };

  return { lines, exportData };
}

function mergeAggregationInputs(
  target: Map<string, ScoreAggregationInput>,
  source: Map<string, ScoreAggregationInput>,
): void {
  for (const input of source.values()) {
    const entry = ensureAggregationEntry(target, input.assignment);
    entry.judgeResults.push(...input.judgeResults);
  }
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
      const assignment: ScoreAssignment = {
        name: score.assignment.name,
        weight: score.assignment.weight,
        args: score.assignment.args,
      };
      const entry = ensureAggregationEntry(aggregationInputs, assignment);

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
  assignment: ScoreAssignment,
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
