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
import type { Judge } from "~/lib/judgeTypes.js";
import { judges, getJudgeModelId } from "~/judges.js";
import { aggregateScores } from "~/lib/utils/scoreAggregation.js";
import type {
  JudgeScoreResult,
  ScoreAggregationInput,
} from "~/lib/utils/scoreAggregation.js";
import type { EvaluationRunExport } from "~/types/export.js";
import { withRetries } from "~/lib/utils/retry.js";

type ModelCombination = string;

interface ParsedCliOptions {
  model: string;
  eval: string;
  outputPath?: string;
}

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

    const abortToken = { __abortEval: true } as const;
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
      let cwd: string | undefined;

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

        assert(tasksExecuted, "No planner tasks have been executed.");

        const hasChanges = finalizeAgentChanges(
          evalDefinition,
          cwd,
          baselineCommit,
        );

        assert(hasChanges, `No changes detected for ${model} on ${evalId}.`);

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
            summaries: evaluationResult.lines,
            exportData: evaluationResult.exportData,
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
        if (cwd) {
          cleanupRepository(cwd, evalDefinition);
        }
      }
    };

    try {
      return await executeCombination();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "__abortEval" in error
      ) {
        assert(false, "evaluation aborted");
      }

      console.error(
        `Failed to complete evaluation ${evalId}: ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
      assert(false, "evaluation failed");
    }
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

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error);
  } else {
    console.error(new Error(String(error)));
  }
  process.exitCode = 1;
});

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
  model: ModelCombination,
  contextLabel: string | undefined,
  cwd: string,
  preparedReferences: Map<string, unknown>,
): Promise<{ lines: string[]; exportData: EvaluationRunExport }> {
  const evalId = datasetEval.repo;
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
    model: model,
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
