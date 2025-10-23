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
import type { ScoreAggregationInput } from "~/lib/utils/scoreAggregation.js";
import type { BenchmarkExport, EvaluationRunExport } from "~/types/export.js";
import { withRetries } from "~/lib/utils/retry.js";

type ScoreName = ScoreAssignment["name"];

type ModelCombination = string;

type FilterKey = "model" | "eval" | "score";
type CliFilters = Partial<Record<FilterKey, string>>;
const VALID_OPTION_KEYS: FilterKey[] = ["model", "eval", "score"];

interface ParsedCliOptions {
  filters: CliFilters;
  outputPath?: string;
}

async function printHelp(): Promise<void> {
  console.log(
    "Usage: orvl <agent> [--model <model>] [--eval <owner/name>] [--score <score>] [--output <file>]",
  );
  console.log("");
  console.log("Examples:");
  console.log("  orvl opencode");
  console.log("  orvl opencode --model qwen3-coder");
  console.log("  orvl opencode --eval noworneverev/graphrag-visualizer");
  console.log();
  console.log("  orvl opencode --output results.json");
  console.log("");
  const agents = await listAgents();
  console.log(
    "Available agents:",
    agents.map((agent) => agent.name).join(", "),
  );
  console.log("Available scores:", listScores().join(", "));
  console.log("Available evals:", listEvalIdentifiers().join(", "));
}

function getEvalIdentifier(entry: DatasetEval): string {
  return entry.repo;
}

function listEvalIdentifiers(): string[] {
  return Array.from(
    new Set(dataset.map((entry) => getEvalIdentifier(entry))),
  ).sort((a, b) => a.localeCompare(b));
}

function validateScoreFilter(name: string | undefined): ScoreName | undefined {
  if (!name) {
    return undefined;
  }

  assert(scoreRegistry[name as ScoreName], `Unknown score: ${name}`);

  return name as ScoreName;
}

function resolveModels(
  agent: AgentRegistration,
  modelFilter: string | undefined,
): ModelCombination[] {
  const combinations: ModelCombination[] = [];

  agent.models.forEach((model) => {
    if (!modelFilter || model === modelFilter) {
      combinations.push(model);
    }
  });

  assert(
    !modelFilter || combinations.length > 0,
    `Model ${modelFilter} is not registered for agent ${agent.name}.`,
  );

  return combinations;
}

function parseOptions(tokens: string[]): ParsedCliOptions {
  const filters: CliFilters = {};
  let outputPath: string | undefined;
  const allowed = new Set<string>([...VALID_OPTION_KEYS, "output"]);

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    assert(
      token.startsWith("--"),
      `Unexpected argument "${token}". Use --model/--eval/--score options.`,
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

    if (rawKey === "output") {
      assert(
        outputPath === undefined,
        'Option "--output" specified multiple times.',
      );
      outputPath = value;
    } else {
      const key = rawKey as FilterKey;
      assert(
        filters[key] === undefined,
        `Option "--${key}" specified multiple times.`,
      );
      filters[key] = value;
    }
    index += 1;
  }

  return { filters, outputPath };
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

  let filters: CliFilters;
  let outputPath: string | undefined;
  try {
    const parsed = parseOptions(args.slice(1));
    filters = parsed.filters;
    outputPath = parsed.outputPath;
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
    return;
  }

  const agent = await getAgent(agentName);
  if (!agent) {
    console.error(`Unknown agent: ${agentName}`);
    await printHelp();
    process.exitCode = 1;
    return;
  }

  let modelCombinations: ModelCombination[];
  try {
    modelCombinations = resolveModels(agent, filters.model);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
    return;
  }

  let scoreFilterName: ScoreName | undefined;
  try {
    scoreFilterName = validateScoreFilter(filters.score);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exitCode = 1;
    return;
  }

  const evalFilter = normalizeEvalFilter(filters.eval);
  const selectedEvals = evalFilter
    ? dataset.filter((entry) => getEvalIdentifier(entry) === evalFilter)
    : dataset;

  if (evalFilter && selectedEvals.length === 0) {
    console.error(`Eval ${evalFilter} was not found.`);
    process.exitCode = 1;
    return;
  }

  const processEvaluation = async (
    evalDefinition: DatasetEval,
    scoreFilter: ScoreName | undefined,
    combinations: ModelCombination[],
    agentRegistration: AgentRegistration,
    agentLabel: string,
  ): Promise<{
    runCount: number;
    exports: EvaluationRunExport[];
    attemptedScore: boolean;
  }> => {
    const availableScores = evalDefinition.scores;
    const scores: ScoreAssignment[] = scoreFilter
      ? availableScores.filter((assignment) => assignment.name === scoreFilter)
      : availableScores;

    if (scores.length === 0) {
      return { runCount: 0, exports: [], attemptedScore: false };
    }

    const abortToken = { __abortEval: true } as const;
    const evalId = getEvalIdentifier(evalDefinition);

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
      throw new Error("evaluation preparation failed");
    }

    const runCombination = async (
      model: string,
    ): Promise<{
      completedRuns: number;
      summaries: string[];
      exports: EvaluationRunExport[];
    }> => {
      let cwd: string;

      try {
        const combinationLabel = `${evalId} ${model}`;
        console.log(`[${combinationLabel}] Cloning repository...`);
        const baselineCommit = evalDefinition.from;
        cwd = cloneRepositoryAtCommit(evalDefinition, baselineCommit);
        const preparedScores = new Map<string, unknown>();

        for (const assignment of scores) {
          const scoreDefinition = scoreRegistry[assignment.name];

          if (!scoreDefinition) {
            console.error(`Score ${assignment.name} is not registered.`);
            continue;
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
            console.error(
              `Failed to prepare score ${assignment.name} for ${combinationLabel}: ${message}`,
            );
            process.exitCode = 1;
            throw abortToken;
          }
        }

        let tasksExecuted = 0;

        for (const task of plannerTasks) {
          const logPrefix = `${combinationLabel} ${task.commit}`;
          await withRetries(
            async () => {
              await agentRegistration.definition.run(model, task.prompt, cwd, {
                onStart: (commandString: string) => {
                  console.log(`[${logPrefix}] ${commandString.trim()}`);
                },
                logPrefix,
              });
            },
            {
              retries: 3,
              onRetry(error, attempt, retries) {
                if (error instanceof Error) {
                  console.error(
                    `Failed to render command for ${model} (attempt ${attempt}/${retries}): ${error.message}`,
                  );
                } else {
                  console.error(
                    `Failed to render command for ${model} (attempt ${attempt}/${retries})`,
                  );
                }

                if (attempt < retries) {
                  console.log(
                    `[${logPrefix}] Retrying agent run (attempt ${attempt + 1}/${retries})...`,
                  );
                }
              },
            },
          ).catch((error) => {
            process.exitCode = 1;
            throw error === abortToken ? error : abortToken;
          });

          tasksExecuted += 1;
        }

        if (tasksExecuted === 0) {
          return { completedRuns: 0, summaries: [], exports: [] };
        }

        const hasChanges = finalizeAgentChanges(
          evalDefinition,
          cwd,
          baselineCommit,
        );

        if (!hasChanges) {
          console.log(
            `No changes detected for ${model} on ${evalId}. Skipping scoring.`,
          );
          return { completedRuns: 0, summaries: [], exports: [] };
        }

        try {
          const evaluationResult = await evaluateScoresForRun(
            agentLabel,
            evalDefinition,
            scores,
            model,
            combinationLabel,
            cwd,
            preparedScores,
          );
          return {
            completedRuns: 1,
            summaries: evaluationResult.lines,
            exports: [evaluationResult.exportData],
          };
        } catch (error) {
          if (error instanceof Error) {
            console.error(
              `Failed to evaluate scores for ${model}: ${error.message}`,
            );
          } else {
            console.error("Failed to evaluate scores for", model);
          }
          process.exitCode = 1;
          throw abortToken;
        }
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "__abortEval" in error
        ) {
          throw error;
        }

        console.error(
          `Failed to prepare combination ${model} for ${evalId}: ${error instanceof Error ? error.message : error}`,
        );
        process.exitCode = 1;
        throw abortToken;
      } finally {
        if (cwd!) {
          cleanupRepository(cwd, evalDefinition);
        }
      }
    };

    try {
      const results = await Promise.all(
        combinations.map((combination) => runCombination(combination)),
      );

      const completed = results.reduce(
        (total, value) => total + value.completedRuns,
        0,
      );

      results.forEach((result) => {
        result.summaries.forEach((line) => {
          console.log(line);
        });
      });

      const exports = results.flatMap((result) => result.exports);

      return { runCount: completed, exports, attemptedScore: true };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "__abortEval" in error
      ) {
        throw new Error("evaluation aborted");
      }

      console.error(
        `Failed to complete evaluation ${evalId}: ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
      throw new Error("evaluation failed");
    }
  };

  let evaluationResults: Array<{
    runCount: number;
    exports: EvaluationRunExport[];
    attemptedScore: boolean;
  }>;
  try {
    evaluationResults = await Promise.all(
      selectedEvals.map((evalDefinition) =>
        processEvaluation(
          evalDefinition,
          scoreFilterName,
          modelCombinations,
          agent,
          agentName,
        ),
      ),
    );
  } catch {
    return;
  }

  const runCount = evaluationResults.reduce(
    (total, result) => total + result.runCount,
    0,
  );

  const runExports = evaluationResults.flatMap((result) => result.exports);

  if (
    scoreFilterName &&
    !evaluationResults.some((result) => result.attemptedScore)
  ) {
    console.error(
      `Score ${scoreFilterName} is not available for the selected evaluations.`,
    );
    process.exitCode = 1;
    return;
  }

  if (runCount === 0) {
    console.error("No runs matched the provided filters.");
    process.exitCode = 1;
  }

  if (outputPath) {
    try {
      const directory = dirname(outputPath);
      if (directory && directory !== ".") {
        mkdirSync(directory, { recursive: true });
      }

      const exportPayload: BenchmarkExport = {
        version: 1,
        runs: runExports,
      };

      writeFileSync(outputPath, JSON.stringify(exportPayload, null, 2));
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

async function evaluateScoresForRun(
  agentName: string,
  datasetEval: DatasetEval,
  scores: ScoreAssignment[],
  model: string,
  contextLabel: string | undefined,
  cwd: string,
  preparedReferences: Map<string, unknown>,
): Promise<{ lines: string[]; exportData: EvaluationRunExport }> {
  const evalId = getEvalIdentifier(datasetEval);
  const runContext = contextLabel ? `${evalId} [${contextLabel}]` : evalId;

  const aggregationInputs = new Map<string, ScoreAggregationInput>();

  for (const judge of judges) {
    for (const assignment of scores) {
      const scoreDefinition = scoreRegistry[assignment.name];

      if (!scoreDefinition) {
        console.error(`Score ${assignment.name} is not registered.`);
        continue;
      }

      if (!preparedReferences.has(assignment.name)) {
        console.error(
          `Score ${assignment.name} did not provide prepared references.`,
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

  const scoreExports: EvaluationRunExport["scores"] = summary.perScore.map(
    (entry) => {
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
    },
  );

  const exportData: EvaluationRunExport = {
    agent: agentName,
    evaluation: {
      repo: datasetEval.repo,
      from: datasetEval.from,
      to: datasetEval.to,
    },
    model,
    summary: {
      finalScore: summary.finalScore,
      baseScore: summary.baseScore,
      variancePenalty: summary.variancePenalty,
    },
    scores: scoreExports,
  };

  return { lines, exportData };
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

function normalizeEvalFilter(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  const suffix = "/benchmark";
  if (value.endsWith(suffix)) {
    return value.slice(0, -suffix.length);
  }

  return value;
}
