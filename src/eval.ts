import { z } from "zod";
import { $ } from "bun";
import { generateObject } from "ai";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "./util/logger.js";
import { Task } from "./tasks/index.js";
import { Agent } from "./agents/index.js";
import { Metric } from "./metrics/index.js";
import { average, variance, weightedSum } from "./util/math.js";
import { Judge } from "./judges.js";
import { getZenLanguageModel } from "./zenModels.js";

export namespace Eval {
  export const DISAGREEMENT_PENALTY = 0.5;
  export type Result = Awaited<ReturnType<typeof run>>;

  export async function run(
    agentName: string,
    modelId: string,
    taskId: string,
    opts: {
      logger: Logger.Instance;
    },
  ) {
    const agent = Agent.get(agentName);
    Agent.validateModel(agent, modelId);
    const task = await Task.get(taskId);
    const cwd = await mkdtemp(join(tmpdir(), "openreval-"));
    $.cwd(cwd);

    try {
      opts.logger.log(`Cloning repository to ${cwd}...`);
      await cloneRepositoryAtCommit(task.source.repo, task.source.from);

      opts.logger.log(`Running pre-task commands...`);
      const beforeResults: Record<string, Metric.CommandExecution[]> = {};
      for (const { name, args } of task.metrics) {
        if (!args) continue;
        const cl = opts.logger.child(`[criterion ${name}]`);
        await runCommands(args.setup, { logger: cl, cwd });
        const results = await runCommands(args.commands, { logger: cl, cwd });
        beforeResults[name] = results;
      }

      opts.logger.log(`Running task...`);
      let duration = 0;
      const usage = { input: 0, output: 0, cost: 0 };
      const actions: string[] = [];
      for (const { commit, prompt } of task.prompts) {
        const cl = opts.logger.child(
          `[prompt ${task.source.repo.split("/")[1]}@${commit.slice(0, 7)}]`,
        );

        const startedAt = Date.now();
        const result = await agent.definition.run(modelId, prompt, {
          cwd,
          logger: cl,
        });
        duration += Date.now() - startedAt;

        // Only accumulate usage from the successful result
        usage.input += result.usage.input;
        usage.output += result.usage.output;
        usage.cost += result.usage.cost;

        // Collect actions from this task
        actions.push(...result.actions);
      }

      opts.logger.log(`Scoring...`);
      await finalizeChanges(task.source.from);
      const diff = await generateDiff(task.source.from);
      const allScores = [];
      for (const { name, weight, args } of task.metrics) {
        const cl = opts.logger.child(`[metric ${name}]`);
        const afterResults = args
          ? await runCommands(args.commands, { logger: cl, cwd })
          : undefined;
        const scores = [];
        for (const judge of Judge.all) {
          const ccl = cl.child(`[judge ${judge}]`);
          let result;
          try {
            result = await judgeScore(
              name,
              judge,
              {
                expectedDiff: task.diff,
                actualDiff: diff,
                beforeResults: beforeResults[name],
                afterResults,
              },
              { logger: ccl },
            );
          } catch (e: any) {
            result = { score: 0, rationale: String(e.message) };
          }
          scores.push({ ...result, judge });
        }
        const avg = average(scores.map((s) => s.score));
        const vrc = variance(
          avg,
          scores.map((s) => s.score),
        );
        allScores.push({
          criterion: name,
          weight,
          average: avg,
          variance: vrc,
          judges: scores,
        });
      }

      const weightedAvg = weightedSum(
        allScores.map(({ average, weight }) => ({ value: average, weight })),
      );
      const weightedVrc = weightedSum(
        allScores.map(({ variance, weight }) => ({ value: variance, weight })),
      );
      const penalty = DISAGREEMENT_PENALTY * weightedVrc;
      const score = Math.max(0, weightedAvg - penalty);

      opts.logger.log(`Score: ${score.toFixed(3)}`);

      return {
        task: taskId,
        model: modelId,
        agent: agentName,
        score: {
          final: score,
          base: weightedAvg,
          penalty,
        },
        scoreDetails: allScores,
        actions,
        usage,
        duration,
      };
    } finally {
      await cleanupRepository(cwd, opts.logger);
    }
  }

  async function finalizeChanges(baselineCommit: string) {
    try {
      await $`git config user.email "opencode-bench@example.com"`.quiet();
      await $`git config user.name "opencode-bench"`.quiet();
    } catch (error) {
      console.error(
        "Failed to configure git user for agent diff:",
        error instanceof Error ? error.message : error,
      );
    }

    try {
      await $`git add --all`.quiet();
    } catch (e) {
      console.error(
        "Failed to stage agent changes:",
        e instanceof Error ? e.message : e,
      );
    }

    let hasStagedChanges = false;
    try {
      await $`git diff --cached --quiet`.quiet();
    } catch {
      hasStagedChanges = true;
    }

    if (hasStagedChanges) {
      try {
        await $`git commit --no-verify -m "opencode-bench-agent-snapshot"`.quiet();
      } catch (e) {
        console.error("Failed to commit agent changes:", e);
      }
    }

    try {
      await $`git diff --exit-code ${baselineCommit} HEAD`.quiet();
      return false;
    } catch (e) {
      if (
        typeof e === "object" &&
        e !== null &&
        "status" in e &&
        (e as { status?: number }).status === 1
      ) {
        return true;
      }

      console.error(
        "Failed to check final agent diff:",
        e instanceof Error ? e.message : e,
      );
      return false;
    }
  }

  async function generateDiff(baselineCommit: string) {
    let diff;
    try {
      diff = (
        await $`git diff --unified=5 ${baselineCommit} HEAD`.text()
      ).trim();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to generate diff:", msg);
      throw e;
    }

    if (diff.length === 0) throw new Error("Diff is empty");
    return diff;
  }

  async function judgeScore(
    criterionName: string,
    judge: string,
    context: Metric.Context,
    opts: { logger: Logger.Instance },
  ) {
    opts.logger.log("Judging...");
    try {
      const c = Metric.all[criterionName as keyof typeof Metric.all];
      const { object } = await generateObject({
        model: getZenLanguageModel(judge),
        schema: z.object({
          score: z.number().refine((val) => val === 0 || val === 1, {
            message: "Score must be binary: 0 (fail) or 1 (pass)",
          }),
          rationale: z.string().min(1),
        }),
        system: c.systemPrompt,
        temperature: 0,
        prompt: c.createUserPrompt(context),
      });
      if (!object || typeof object !== "object")
        throw new Error("Score evaluators must return an object.");
      if (typeof object.score !== "number")
        throw new Error("Score evaluators must return a number.");
      if (typeof object.rationale !== "string" || object.rationale.length === 0)
        throw new Error("Score evaluators must include a rationale string.");
      if (object.score < 0 || object.score > 1)
        throw new Error(
          "Score evaluators must return a score between 0 and 1.",
        );

      opts.logger.log("Judge result:", object);
      return object;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to judge score:", msg);
      throw e;
    }
  }

  async function runCommands(
    commands: string[],
    opts: { logger: Logger.Instance; cwd: string },
  ) {
    const results = [];

    for (const command of commands) {
      opts.logger.log(command);
      const result = await runCommand(command, opts.cwd);
      opts.logger.log(...formatExecutionForLog(result).split("\n"));
      results.push(result);
    }

    return results;
  }

  async function runCommand(command: string, cwd: string) {
    const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

    const start = Date.now();

    return await new Promise<Metric.CommandExecution>((resolve) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        env: {
          ...process.env,
          CI: process.env.CI ?? "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let errorMessage: string | undefined;
      let timeout: NodeJS.Timeout | undefined;
      let settled = false;

      timeout = setTimeout(() => {
        errorMessage = `Timed out after ${COMMAND_TIMEOUT_MS}ms`;
        child.kill("SIGKILL");
      }, COMMAND_TIMEOUT_MS);

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        errorMessage = error.message;
      });

      child.on("close", (code) => {
        const exitCode = typeof code === "number" ? code : null;
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);

        const runtimeMs = Date.now() - start;
        const success = exitCode === 0 && !errorMessage;

        resolve({
          command,
          success,
          exitCode,
          stdout,
          stderr,
          runtimeMs,
          errorMessage,
        });
      });
    });
  }

  function formatExecutionForLog(execution: Metric.CommandExecution): string {
    const status = execution.success ? "PASS" : "FAIL";
    const exitInfo =
      execution.exitCode !== null
        ? `exit ${execution.exitCode}`
        : "no exit code";
    const duration = `${execution.runtimeMs}ms`;
    const error = execution.errorMessage
      ? ` error: ${execution.errorMessage}`
      : "";

    return `${status} (${exitInfo}, ${duration})${error}`;
  }

  async function cloneRepositoryAtCommit(repo: string, commitSha: string) {
    await $`git init`.quiet();
    await $`git remote add origin https://github.com/${repo}.git`.quiet();
    await $`git fetch --depth 1 origin ${commitSha}`.quiet();
    await $`git checkout --detach FETCH_HEAD`.quiet();
    await $`git reset --hard FETCH_HEAD`.quiet();
  }

  async function cleanupRepository(
    cwd: string,
    logger: Logger.Instance,
  ): Promise<void> {
    try {
      await rm(cwd, { recursive: true, force: true });
    } catch (e) {
      logger.error(
        `Failed to clean up temporary repo:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}
