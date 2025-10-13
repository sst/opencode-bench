import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";
import { z } from "zod";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const commandConfigSchema = z.object({
  commands: z.array(z.string().min(1)).min(1, "At least one check command is required.")
});

interface CommandExecution {
  command: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  runtimeMs: number;
  errorMessage?: string;
}

interface PreparedCheck {
  command: string;
  baseline: CommandExecution;
  after?: CommandExecution;
}

const systemPrompt = `You are evaluating whether project checks still pass after an autonomous agent modified the codebase.
The reference state shows results before the agent ran; the candidate state shows results after the agent's changes.
Score the outcome from 0 to 1:
- Score 1.0 only if every command that previously succeeded still succeeds and the project remains healthy.
- Reduce the score when commands fail, behave differently, or were disrupted by the agent's changes.
- Consider previously failing commands: give partial credit if the agent improves them, penalise if failures worsen.
Respond with JSON containing numeric 'score' (0-1) and a concise 'rationale' summarising key successes or failures.`;

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_LIMIT = 4000;

export default createScore<PreparedCheck[], z.infer<typeof commandConfigSchema>>({
  prepare: ({ cwd, evaluation, config }) => {
    const parsedConfig = commandConfigSchema.parse(config ?? {});
    const results: PreparedCheck[] = parsedConfig.commands.map((command) => ({
      command,
      baseline: runCommand(command, cwd)
    }));

    assert(
      results.length > 0,
      `Score "checks" requires at least one command for ${evaluation.repo}.`
    );

    return results;
  },
  evaluate: async ({ evaluation, cwd, judge, reference, config: _config }) => {
    finalizeAgentChanges(evaluation, cwd, evaluation.from);

    reference.forEach((entry) => {
      if (!entry.after) {
        entry.after = runCommand(entry.command, cwd);
      }
    });

    const prompt = buildJudgePrompt(reference);

    try {
      const { object } = await generateObject({
        model: judge.model,
        schema: scoreResultSchema,
        system: systemPrompt,
        temperature: 0,
        prompt
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Checks score evaluation failed: ${message}`
      };
    }
  }
});

function runCommand(command: string, cwd: string): CommandExecution {
  const start = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    env: {
      ...process.env,
      CI: process.env.CI ?? "1"
    }
  });

  const runtimeMs = Date.now() - start;
  const stdout = (result.stdout ?? "").toString();
  const stderr = (result.stderr ?? "").toString();

  let exitCode: number | null = null;
  let success = false;
  let errorMessage: string | undefined;

  if (typeof result.status === "number") {
    exitCode = result.status;
    success = exitCode === 0;
  }

  if (result.error) {
    success = false;
    errorMessage = result.error.message;
  }

  return {
    command,
    success,
    exitCode,
    stdout,
    stderr,
    runtimeMs,
    errorMessage
  };
}

function buildJudgePrompt(entries: PreparedCheck[]): string {
  const formatted = entries
    .map((entry, index) => {
      const baseline = formatExecution(entry.baseline);
      const after = entry.after ? formatExecution(entry.after) : "not executed";
      return [
        `Check ${index + 1}: ${entry.command}`,
        `Baseline: ${baseline}`,
        `After agent: ${after}`
      ].join("\n");
    })
    .join("\n\n");

  return `Evaluate the following project checks. Each check shows the command, its baseline result before the agent ran, and the result after the agent's changes.\n\n${formatted}\n\nDecide how well the agent preserved or improved the checks.`;
}

function formatExecution(execution: CommandExecution): string {
  const status = execution.success ? "PASS" : "FAIL";
  const exitInfo =
    execution.exitCode !== null ? `exit ${execution.exitCode}` : "no exit code";
  const duration = `${execution.runtimeMs}ms`;
  const stderr = summarizeOutput(execution.stderr);
  const stdout = summarizeOutput(execution.stdout);
  const error = execution.errorMessage ? ` error: ${execution.errorMessage}` : "";

  return `${status} (${exitInfo}, ${duration})${error}\nstdout: ${stdout}\nstderr: ${stderr}`;
}

function summarizeOutput(output: string): string {
  if (!output) {
    return "<empty>";
  }

  const normalized = output.trim();
  if (normalized.length <= OUTPUT_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, OUTPUT_LIMIT)}…`;
}
