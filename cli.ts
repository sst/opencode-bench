#!/usr/bin/env node
import { strict as assert } from "node:assert";
import process from "node:process";

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { getAgent, listAgents } from "~/agents/index.js";
import type { AgentRegistration } from "~/agents/index.js";
import { listScores, scores as scoreRegistry } from "~/scores/index.js";
import { dataset } from "~/lib/dataset.js";
import type { DatasetEval, ScoreAssignment } from "~/lib/dataset.js";
import { generatePlannerTasks, type PlannerTask } from "~/lib/planner.js";
import { fetchPlannerCommitDiffs } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";
import { judges, getJudgeModelId } from "~/judges.js";
import { aggregateScores } from "~/lib/utils/scoreAggregation.js";
import type { Judge } from "~/lib/judgeTypes.js";
import type {
  AggregationSummary,
  ScoreAggregationInput,
} from "~/lib/utils/scoreAggregation.js";
import type { Episode, EvaluationRunExport } from "~/types/export.js";
import { withRetries } from "~/lib/utils/retry.js";

type ModelCombination = string;

interface ParsedCliOptions {
  model: string;
  eval: string;
  outputPath?: string;
}

const EPISODES = 3;

async function printHelp(): Promise<void> {
  console.log(
    "Usage: orvl <agent> --model <model> --eval <owner/name> [--output <file>]",
  );
  console.log("");
  console.log("Examples:");
  console.log(
    "  orvl opencode --model opencode/gpt-5-codex --eval noworneverev/graphrag-visualizer",
  );
  console.log(
    "  orvl opencode --model opencode/claude-sonnet-4-5 --eval prismicio-community/course-fizzi-next",
  );
  console.log();
  console.log(
    "  orvl opencode --model opencode/gpt-5-codex --eval prismicio-community/course-fizzi-next --output results.json",
  );
  console.log("");
  const agents = await listAgents();
  console.log(
    "Available agents:",
    agents.map((agent) => agent.name).join(", "),
  );
  console.log("Available scores:", listScores().join(", "));
  console.log("Available evals:", listEvalIdentifiers().join(", "));
}

function listEvalIdentifiers(): string[] {
  return Array.from(new Set(dataset.map((entry) => entry.repo))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function parseOptions(tokens: string[]): ParsedCliOptions {
  let model: string | undefined;
  let evalId: string | undefined;
  let outputPath: string | undefined;
  const allowed = new Set<string>(["model", "eval", "output"]);

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    assert(
      token.startsWith("--"),
      `Unexpected argument "${token}". Use --model/--eval options.`,
    );

    const option = token.slice(2);
    const [rawKey, inlineValue] = option.split("=", 2);
    assert(rawKey, "Invalid CLI option format.");
    assert(allowed.has(rawKey), `Unknown option "--${rawKey}".`);

    let value = inlineValue;
    if (value === undefined) {
      index += 1;
      const next = tokens[index];
      assert(
        next !== undefined && !next.startsWith("--"),
        `Option "--${rawKey}" requires a value.`,
      );
      value = tokens[index];
    }

    assert(value, `Option "--${rawKey}" cannot be empty.`);

    switch (rawKey) {
      case "output":
        assert(
          outputPath === undefined,
          'Option "--output" specified multiple times.',
        );
        outputPath = value;
        break;
      case "model":
        assert(
          model === undefined,
          'Option "--model" specified multiple times.',
        );
        model = value;
        break;
      case "eval":
        assert(
          evalId === undefined,
          'Option "--eval" specified multiple times.',
        );
        evalId = value;
        break;
      default:
        assert(false, `Unknown option "--${rawKey}".`);
    }
    index += 1;
  }

  assert(model, 'Required option "--model" is missing.');
  assert(evalId, 'Required option "--eval" is missing.');

  return {
    model: model!,
    eval: evalId!,
    outputPath,
  };
}

function isHelpRequest(arg: string | undefined): boolean {
  return (
    arg === undefined || arg === "--help" || arg === "-h" || arg === "help"
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const agentName = args[0];

  if (isHelpRequest(agentName)) {
    await printHelp();
    return;
  }

  let options: ParsedCliOptions;
  try {
    options = parseOptions(args.slice(1));
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
    return;
  }

  const { model: modelFilter, eval: evalFilter, outputPath } = options;

  const agent = await getAgent(agentName);
  if (!agent) {
    console.error(`Unknown agent: ${agentName}`);
    await printHelp();
    process.exitCode = 1;
    return;
  }

  const model = agent.models.find((entry) => entry === modelFilter);

  assert(
    model,
    `Model ${modelFilter} is not registered for agent ${agent.name}.`,
  );

  const evalDefinition = dataset.find((entry) => entry.repo === evalFilter);

  if (!evalDefinition) {
    console.error(`Eval ${evalFilter ?? evalFilter} was not found.`);
    process.exitCode = 1;
    return;
  }

  const processEvaluation = async (
    evalDefinition: DatasetEval,
    agentRegistration: AgentRegistration,
    agentLabel: string,
  ): Promise<{
    summaries: string[];
    exportData?: EvaluationRunExport;
  }> => {
    const scores: ScoreAssignment[] = evalDefinition.scores;
    if (scores.length === 0) {
      const message = `Evaluation ${evalDefinition.repo} has no score assignments configured.`;
      console.error(message);
      process.exitCode = 1;
      assert(false, message);
    }

    const evalId = evalDefinition.repo;

    let plannerTasks: PlannerTask[] = [];

    try {
      console.log(`[${evalId} planner] Fetching commit diffs from GitHub...`);
      const commitDiffs = await fetchPlannerCommitDiffs(evalDefinition);

      assert(
        commitDiffs.length > 0,
        `No commits found between ${evalDefinition.from} and ${evalDefinition.to} for ${evalDefinition.repo}.`,
      );

      plannerTasks = await generatePlannerTasks(evalDefinition, commitDiffs);

      assert(
        plannerTasks.length > 0,
        `Planner produced no tasks for ${evalDefinition.repo} (${evalDefinition.from}..${evalDefinition.to}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        console.error(
          `Failed to prepare evaluation ${evalId}: ${error.message}`,
        );
      } else {
        console.error("Failed to prepare evaluation", evalId);
      }
      process.exitCode = 1;
      assert(false, "evaluation preparation failed");
    }

    const executeCombination = async (): Promise<{
      summaries: string[];
      exportData?: EvaluationRunExport;
    }> => {
      const combinationLabel = `${evalId} ${model}`;

      interface EpisodeResult {
        index: number;
        aggregation: Map<string, ScoreAggregationInput>;
        summary: AggregationSummary;
        scoreExports: EvaluationRunExport["scores"];
        summaryLine: string;
      }

      const runEpisode = async (
        episodeIndex: number,
      ): Promise<EpisodeResult> => {
        const episodeTag = `[episode ${episodeIndex}/${EPISODES}]`;
        const baselineCommit = evalDefinition.from;
        const prefix = `${episodeTag} [${combinationLabel}]`;
        let cwd: string | undefined;

        const fail = (message: string): never => {
          const formatted = `${prefix} ${message}`;
          console.error(formatted);
          process.exitCode = 1;
          throw new Error(formatted);
        };

        try {
          console.log(`${prefix} Cloning repository...`);
          cwd = cloneRepositoryAtCommit(evalDefinition, baselineCommit);

          const preparedScores = new Map<string, unknown>();
          for (const assignment of scores) {
            const scoreDefinition = scoreRegistry[assignment.name];

            if (!scoreDefinition) {
              fail(`Score ${assignment.name} is not registered.`);
            }

            try {
              const prepared = await scoreDefinition.prepare({
                evaluation: evalDefinition,
                cwd,
                config: assignment.args,
              });
              preparedScores.set(assignment.name, prepared);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              fail(`Failed to prepare score ${assignment.name}: ${message}`);
            }
          }

          let tasksExecuted = 0;

          for (const task of plannerTasks) {
            const logPrefix = `${prefix} ${task.commit}`;

            try {
              await withRetries(
                async () => {
                  await agentRegistration.definition.run(
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
                        `${logPrefix} Retrying agent run (attempt ${attempt + 1}/${retries})...`,
                      );
                    }
                  },
                },
              );
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              fail(
                `Agent run failed for planner task ${task.commit}: ${message}`,
              );
            }

            tasksExecuted += 1;
          }

          if (tasksExecuted === 0) {
            fail("No planner tasks have been executed.");
          }

          const hasChanges = finalizeAgentChanges(
            evalDefinition,
            cwd,
            baselineCommit,
          );

          if (!hasChanges) {
            fail("No changes detected for this episode.");
          }

          const episodeAggregation = await collectAggregationInputsForRun(
            evalDefinition,
            scores,
            model,
            cwd,
            preparedScores,
          );

          if (episodeAggregation.size === 0) {
            fail("No score results were produced for this episode.");
          }

          const summary = aggregateScores(
            Array.from(episodeAggregation.values()),
          );

          const episodeScoreExports = buildScoreExportsFromAggregation(
            episodeAggregation,
            summary,
          );

          console.log(
            `${prefix} Episode completed with final score ${summary.finalScore.toFixed(3)} (base ${summary.baseScore.toFixed(3)} - variance penalty ${summary.variancePenalty.toFixed(3)})`,
          );

          return {
            index: episodeIndex,
            aggregation: episodeAggregation,
            summary,
            scoreExports: episodeScoreExports,
            summaryLine: `${episodeTag} Episode final score ${summary.finalScore.toFixed(3)}.`,
          };
        } finally {
          if (cwd) {
            cleanupRepository(cwd, evalDefinition);
          }
        }
      };

      const episodeResults = await Promise.all(
        Array.from({ length: EPISODES }, (_, offset) => runEpisode(offset + 1)),
      );

      episodeResults.sort((a, b) => a.index - b.index);

      const aggregatedInputs = new Map<string, ScoreAggregationInput>();
      const episodeSummaries: string[] = [];
      const episodeExports: Episode[] = [];

      for (const result of episodeResults) {
        mergeAggregationInputs(aggregatedInputs, result.aggregation);
        episodeSummaries.push(result.summaryLine);
        episodeExports.push({
          finalScore: result.summary.finalScore,
          baseScore: result.summary.baseScore,
          variancePenalty: result.summary.variancePenalty,
          scores: result.scoreExports,
        });
      }

      const { lines, exportData } = summarizeAggregation(
        agentLabel,
        evalDefinition,
        model,
        combinationLabel,
        aggregatedInputs,
        episodeExports,
      );

      return {
        summaries: [...episodeSummaries, ...lines],
        exportData,
      };
    };

    return await executeCombination();
  };

  try {
    const evaluationResult = await processEvaluation(
      evalDefinition,
      agent,
      agentName,
    );

    evaluationResult.summaries.forEach((line) => {
      console.log(line);
    });

    if (evaluationResult.exportData) {
      const { episodes, finalScore, baseScore, variancePenalty } =
        evaluationResult.exportData;
      if (episodes.length > 0) {
        console.log("[debug] Episode recap:");
        episodes.forEach((episode, index) => {
          console.log(
            `[debug]   Episode ${index + 1}: final ${episode.finalScore.toFixed(3)} (base ${episode.baseScore.toFixed(3)} - penalty ${episode.variancePenalty.toFixed(3)})`,
          );
        });
      }
      console.log(
        `[debug] Aggregate final: ${finalScore.toFixed(3)} (base ${baseScore.toFixed(3)} - penalty ${variancePenalty.toFixed(3)})`,
      );
    }

    if (outputPath) {
      try {
        const directory = dirname(outputPath);
        if (directory && directory !== ".") {
          mkdirSync(directory, { recursive: true });
        }

        writeFileSync(
          outputPath,
          JSON.stringify(evaluationResult.exportData, null, 2),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown error writing output.";
        console.error(`Failed to write export to ${outputPath}: ${message}`);
        process.exitCode = 1;
        return;
      }
    }
  } catch {
    return;
  }
}

main()
  .catch((error) => {
    if (error instanceof Error) {
      console.error(error);
    } else {
      console.error(new Error(String(error)));
    }
    process.exitCode = 1;
  })
  .finally(process.exit);

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
  scores: ScoreAssignment[],
  model: ModelCombination,
  cwd: string,
  preparedReferences: Map<string, unknown>,
): Promise<Map<string, ScoreAggregationInput>> {
  const aggregationInputs = new Map<string, ScoreAggregationInput>();

  for (const judge of judges) {
    for (const assignment of scores) {
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
): { lines: string[]; exportData: EvaluationRunExport } {
  const evalId = datasetEval.repo;
  const runContext = contextLabel ? `${evalId} [${contextLabel}]` : evalId;

  const summary = aggregateScores(Array.from(aggregationInputs.values()));

  const lines: string[] = [];
  lines.push(`\nScore breakdown for ${model} on ${runContext}:`);
  const formatRawWeight = (value: number): string => {
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return Number(value.toPrecision(6)).toString();
  };

  summary.perScore.forEach((entry) => {
    lines.push(
      `  ${entry.assignment.name} → ${entry.averageScore.toFixed(3)} (weight ${formatRawWeight(entry.assignment.weight)}, normalized ${entry.normalizedWeight.toFixed(3)})`,
    );
    const raw = aggregationInputs.get(entry.assignment.name);
    if (raw) {
      raw.judgeResults.forEach((result) => {
        lines.push(
          `    - ${result.judge.name}: ${result.score.toFixed(3)} → ${result.rationale}`,
        );
      });
    }
  });

  lines.push(
    `  Final aggregate score: ${summary.finalScore.toFixed(3)} (base ${summary.baseScore.toFixed(3)} - penalty ${summary.variancePenalty.toFixed(3)})\n`,
  );

  const scoreExports = buildScoreExportsFromEpisodes(episodes);

  const exportData: EvaluationRunExport = {
    agent: agentName,
    evaluation: {
      repo: datasetEval.repo,
      from: datasetEval.from,
      to: datasetEval.to,
    },
    model,
    jobUrl: process.env.GITHUB_BENCHMARK_JOB_URL,
    finalScore: summary.finalScore,
    baseScore: summary.baseScore,
    variancePenalty: summary.variancePenalty,
    scores: scoreExports,
    episodes,
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
  summary: AggregationSummary,
): EvaluationRunExport["scores"] {
  return summary.perScore.map((entry) => {
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
