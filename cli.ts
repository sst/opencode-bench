#!/usr/bin/env node
import { strict as assert } from "node:assert";
import process from "node:process";

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getAgent, listAgents } from "~/agents/index.js";
import type { AgentRegistration } from "~/agents/index.js";
import { listScores, scores as scoreRegistry } from "~/scores/index.js";
import { dataset } from "~/lib/dataset.js";
import type { DatasetEval, ScoreAssignment } from "~/lib/dataset.js";
import {
  generatePlannerTasks,
  type PlannerCommitDiff,
} from "~/lib/planner.js";
import type { Judge } from "~/lib/judgeTypes.js";
import { judges } from "~/judges.js";
import { aggregateScores } from "~/lib/utils/scoreAggregation.js";
import type {
  JudgeScoreResult,
  ScoreAggregationInput,
} from "~/lib/utils/scoreAggregation.js";

type ScoreName = ScoreAssignment["name"];

interface ModelCombination {
  provider: string;
  model: string;
}

type FilterKey = "model" | "eval" | "score";
type CliFilters = Partial<Record<FilterKey, string>>;
const VALID_OPTION_KEYS: FilterKey[] = ["model", "eval", "score"];

async function printHelp(): Promise<void> {
  console.log(
    "Usage: orvl <agent> [--model <model>] [--eval <owner/name>] [--score <score>]",
  );
  console.log("");
  console.log("Examples:");
  console.log("  orvl opencode");
  console.log("  orvl opencode --model qwen3-coder");
  console.log("  orvl opencode --eval noworneverev/graphrag-visualizer");
  console.log(
    "  orvl opencode --eval noworneverev/graphrag-visualizer --score semantic-similarity",
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

  let providerFilter: string | undefined;
  let normalizedModelFilter = modelFilter;

  if (modelFilter && modelFilter.includes("/")) {
    const [providerPart, modelPart] = modelFilter.split("/", 2);
    if (providerPart && modelPart) {
      providerFilter = providerPart;
      normalizedModelFilter = modelPart;
    }
  }

  Object.entries(agent.models).forEach(([provider, models]) => {
    if (providerFilter && provider !== providerFilter) {
      return;
    }

    models.forEach((model) => {
      if (!normalizedModelFilter || model === normalizedModelFilter) {
        combinations.push({
          provider,
          model,
        });
      }
    });
  });

  assert(
    !modelFilter || combinations.length > 0,
    `Model ${modelFilter} is not registered for agent ${agent.name}.`,
  );

  return combinations;
}

function parseFilters(tokens: string[]): CliFilters {
  const filters: CliFilters = {};
  const allowed = new Set<FilterKey>(VALID_OPTION_KEYS);

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
    assert(allowed.has(rawKey as FilterKey), `Unknown option "--${rawKey}".`);

    const key = rawKey as FilterKey;
    assert(
      filters[key] === undefined,
      `Option "--${key}" specified multiple times.`,
    );

    let value = inlineValue;
    if (value === undefined) {
      index += 1;
      const next = tokens[index];
      assert(
        next !== undefined && !next.startsWith("--"),
        `Option "--${key}" requires a value.`,
      );
      value = tokens[index];
    }

    assert(value, `Option "--${key}" cannot be empty.`);

    filters[key] = value;
    index += 1;
  }

  return filters;
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
  try {
    filters = parseFilters(args.slice(1));
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

  const evalFilter = filters.eval;
  const selectedEvals = evalFilter
    ? dataset.filter((entry) => getEvalIdentifier(entry) === evalFilter)
    : dataset;

  if (evalFilter && selectedEvals.length === 0) {
    console.error(`Eval ${evalFilter} was not found.`);
    process.exitCode = 1;
    return;
  }

  let runCount = 0;

  for (const evalDefinition of selectedEvals) {
    const availableScores = evalDefinition.scores;
    const scores: ScoreAssignment[] = scoreFilterName
      ? availableScores.filter(
          (assignment) => assignment.name === scoreFilterName,
        )
      : availableScores;

    if (scores.length === 0) {
      continue;
    }

    let repoDir: string | undefined;
    const abortToken = { __abortEval: true } as const;

    try {
      repoDir = cloneRepository(evalDefinition);
      const rangeDiff = getDatasetDiff(evalDefinition, repoDir);
      const commitDiffs = getCommitDiffs(evalDefinition, repoDir);

      const plannerTasks = await generatePlannerTasks(
        evalDefinition,
        commitDiffs,
      );

      assert(
        plannerTasks.length > 0,
        `Planner produced no tasks for ${evalDefinition.repo} (${evalDefinition.from}..${evalDefinition.to}).`,
      );

      for (const combination of modelCombinations) {
        try {
          resetRepositoryToBaseline(evalDefinition, repoDir);
        } catch (error) {
          if (error instanceof Error) {
            console.error(
              `Failed to reset repository for ${combination.model}: ${error.message}`,
            );
          } else {
            console.error(
              `Failed to reset repository for ${combination.model}:`,
              error,
            );
          }
          process.exitCode = 1;
          throw abortToken;
        }

        let tasksExecuted = 0;

        for (const task of plannerTasks) {
        try {
          const promptForAgent = task.prompt;
          await agent.definition.run(
            combination.provider,
            combination.model,
            promptForAgent,
            repoDir,
            {
              onStart: (commandString) => {
                console.log(`[${task.commit}] ${commandString.trim()}`);
              },
            },
          );

          tasksExecuted += 1;
        } catch (error) {
            if (error instanceof Error) {
              console.error(
                `Failed to render command for ${combination.model}: ${error.message}`,
              );
            } else {
              console.error("Failed to render command for", combination.model);
            }
            process.exitCode = 1;
            throw abortToken;
          }
          }

        if (tasksExecuted > 0) {
          try {
            const finalDiff = finalizeAgentDiff(evalDefinition, repoDir);

            if (finalDiff === null) {
              console.log(
                `No changes detected for ${combination.model} on ${getEvalIdentifier(evalDefinition)}. Skipping scoring.`,
              );
            } else {
              await evaluateScoresForRun(
                evalDefinition,
                scores,
                finalDiff,
                combination.model,
              );
              runCount += 1;
            }
          } catch (error) {
            if (error instanceof Error) {
              console.error(
                `Failed to evaluate scores for ${combination.model}: ${error.message}`,
              );
            } else {
              console.error(
                "Failed to evaluate scores for",
                combination.model,
              );
            }
            process.exitCode = 1;
            throw abortToken;
          }
        }
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "__abortEval" in error
      ) {
        return;
      }

      if (error instanceof Error) {
        console.error(
          `Failed to prepare evaluation ${getEvalIdentifier(evalDefinition)}: ${error.message}`,
        );
      } else {
        console.error(
          "Failed to prepare evaluation",
          getEvalIdentifier(evalDefinition),
        );
      }
      process.exitCode = 1;
      return;
    } finally {
      if (repoDir) {
        cleanupRepository(repoDir, evalDefinition);
      }
    }
  }

  if (scoreFilterName && runCount === 0) {
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
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

function cloneRepository(entry: DatasetEval): string {
  const remoteUrl = `https://github.com/${entry.repo}.git`;
  const tempDir = mkdtempSync(join(tmpdir(), "openreval-"));
  console.log(tempDir);

  try {
    execSync(`git clone ${remoteUrl} .`, {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync(`git checkout ${entry.to}`, {
      cwd: tempDir,
      stdio: "ignore",
    });
    return tempDir;
  } catch (error) {
    cleanupRepository(tempDir, entry);
    throw error;
  }
}

function getCommitDiffs(
  entry: DatasetEval,
  repoDir: string,
): PlannerCommitDiff[] {
  try {
    const commitRange = execSync(
      `git rev-list --ancestry-path --reverse ${entry.from}..${entry.to}`,
      {
        cwd: repoDir,
        encoding: "utf8",
      },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return commitRange.map((sha) => {
      let title = "";
      try {
        title = execSync(`git log -1 --pretty=%s ${sha}`, {
          cwd: repoDir,
          encoding: "utf8",
        }).trim();
      } catch (error) {
        console.error(
          `Failed to read commit title for ${sha} in ${entry.repo}:`,
          error instanceof Error ? error.message : error,
        );
      }

      let diff = "";
      try {
        diff = execSync(
          `git show ${sha} --format=format: --unified=5 --no-color`,
          {
            cwd: repoDir,
            encoding: "utf8",
          },
        );
      } catch (error) {
        console.error(
          `Failed to compute diff for commit ${sha} in ${entry.repo}:`,
          error instanceof Error ? error.message : error,
        );
      }

      return {
        sha,
        title: title || "(no commit title)",
        diff,
      };
    });
  } catch (error) {
    console.error(
      `Failed to enumerate commits for ${entry.repo}:`,
      error instanceof Error ? error.message : error,
    );
  }

  return [];
}

function getDatasetDiff(entry: DatasetEval, repoDir: string): string {
  try {
    const diff = execSync(`git diff --unified=5 ${entry.from} ${entry.to}`, {
      cwd: repoDir,
      encoding: "utf8",
    });

    if (diff.trim().length > 0) {
      return diff;
    }
  } catch (error) {
    console.error(
      `Failed to compute git diff for ${entry.repo}:`,
      error instanceof Error ? error.message : error,
    );
  }

  return entry.prompt;
}

function finalizeAgentDiff(entry: DatasetEval, repoDir: string): string | null {
  try {
    execSync(`git config user.email "openreval@example.com"`, {
      cwd: repoDir,
      stdio: "ignore",
    });
    execSync(`git config user.name "OpenReval Agent"`, {
      cwd: repoDir,
      stdio: "ignore",
    });
  } catch (error) {
    console.error(
      "Failed to configure git user for agent diff:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    execSync(`git add --all`, {
      cwd: repoDir,
      stdio: "ignore",
    });
  } catch (error) {
    console.error(
      "Failed to stage agent changes:",
      error instanceof Error ? error.message : error,
    );
  }

  let hasStagedChanges = false;
  try {
    execSync(`git diff --cached --quiet`, {
      cwd: repoDir,
      stdio: "ignore",
    });
  } catch {
    hasStagedChanges = true;
  }

  if (hasStagedChanges) {
    try {
      execSync(`git commit --no-verify -m "openreval-agent-snapshot"`, {
        cwd: repoDir,
        stdio: "ignore",
      });
    } catch (error) {
      console.error(
        "Failed to commit agent changes:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  try {
    const diff = execSync(`git diff --unified=5 ${entry.to} HEAD`, {
      cwd: repoDir,
      encoding: "utf8",
    });

    const trimmed = diff.trim();
    if (trimmed.length === 0) {
      return null;
    }

    return diff;
  } catch (error) {
    console.error(
      "Failed to compute final agent diff:",
      error instanceof Error ? error.message : error,
    );
  }

  return null;
}

function resetRepositoryToBaseline(entry: DatasetEval, repoDir: string): void {
  try {
    execSync(`git reset --hard ${entry.to}`, {
      cwd: repoDir,
      stdio: "ignore",
    });
    execSync(`git clean -fd`, {
      cwd: repoDir,
      stdio: "ignore",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function evaluateScoresForRun(
  datasetEval: DatasetEval,
  scores: ScoreAssignment[],
  diff: string,
  model: string,
  contextLabel?: string,
): Promise<void> {
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

      try {
        const result = await scoreDefinition.evaluate({ diff, judge });

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

  console.log(`\nScore breakdown for ${model} on ${runContext}:`);
  if (diff === null) {
    console.log("  No diff provided; scores default to 0.");
    return;
  }

  summary.perScore.forEach((entry) => {
    console.log(
      `  ${entry.assignment.name} → ${entry.averageScore.toFixed(3)} (weight ${entry.normalizedWeight.toFixed(2)})`,
    );
    const raw = aggregationInputs.get(entry.assignment.name);
    if (raw) {
      raw.judgeResults.forEach((result) => {
        console.log(
          `    - ${result.judge.name}: ${result.score.toFixed(3)} → ${result.rationale}`,
        );
      });
    }
  });

  console.log(
    `  Final aggregate score: ${summary.finalScore.toFixed(3)} (base ${summary.baseScore.toFixed(3)} - penalty ${summary.variancePenalty.toFixed(3)})\n`,
  );
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
