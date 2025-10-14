import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";
import { z } from "zod";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const commandConfigSchema = z.object({
  setup: z.array(z.string().min(1)).default([]),
  commands: z.array(z.string().min(1)).min(1, "At least one check command is required."),
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

const systemPrompt = `You are grading whether project checks stayed healthy after an autonomous agent's changes.

For each command you see:
- Baseline → how the check behaved before the agent ran.
- After agent → how it behaves afterwards.

Scoring rubric:
- 1.0 → Every command that previously passed still passes, no new failures were introduced.
- 0.7 → Previously failing commands improved (fewer errors, exit code closer to success) and nothing regressed.
- 0.4 → No net change in failing commands, but no regressions either.
- 0.0 → Any previously passing command now fails, or additional failures/regressions were introduced.

Grade each command, then choose the overall score that best represents the combined outcome (never exceed 1.0). Always mention the key facts (exit codes, failure counts, new vs removed errors) in your rationale so the reasoning is transparent.`;

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_LIMIT = 4000;

type ChecksConfig = z.infer<typeof commandConfigSchema>;

export default createScore<PreparedCheck[], ChecksConfig>({
  prepare: ({ cwd, evaluation, config }) => {
    const parsedConfig = commandConfigSchema.parse(config ?? {});

    parsedConfig.setup.forEach((command) => {
      const result = runCommand(command, cwd);
      logSetupExecution(command, result);
    });

    const results: PreparedCheck[] = parsedConfig.commands.map((command) => {
      const baseline = runCommand(command, cwd);
      logExecution("baseline", command, baseline);
      return {
        command,
        baseline
      };
    });

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
        logExecution("after", entry.command, entry.after);
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

function logExecution(stage: "baseline" | "after", command: string, execution: CommandExecution): void {
  const header =
    stage === "baseline" ? "[checks] Baseline" : "[checks] After agent";
  const formatted = formatExecution(execution);
  console.log(`${header} ${command}\n${formatted}\n`);

  if (!execution.success) {
    const stdoutLabel =
      stage === "baseline"
        ? "[checks] Baseline stdout"
        : "[checks] After agent stdout";
    const stderrLabel =
      stage === "baseline"
        ? "[checks] Baseline stderr"
        : "[checks] After agent stderr";

    const rawStdout = execution.stdout?.trim() ?? "";
    const rawStderr = execution.stderr?.trim() ?? "";

    console.log(
      `${stdoutLabel} ${command}\n${rawStdout.length > 0 ? rawStdout : "<empty>"}\n`,
    );
    console.log(
      `${stderrLabel} ${command}\n${rawStderr.length > 0 ? rawStderr : "<empty>"}\n`,
    );

    if (execution.errorMessage) {
      const errorLabel =
        stage === "baseline"
          ? "[checks] Baseline error"
          : "[checks] After agent error";
      console.log(`${errorLabel} ${command}\n${execution.errorMessage}\n`);
    }
  }
}

function logSetupExecution(command: string, execution: CommandExecution): void {
  const formatted = formatExecution(execution);
  console.log(`[checks] Setup ${command}\n${formatted}\n`);

  if (!execution.success) {
    const stdoutLabel = `[checks] Setup stdout`;
    const stderrLabel = `[checks] Setup stderr`;

    const rawStdout = execution.stdout?.trim() ?? "";
    const rawStderr = execution.stderr?.trim() ?? "";

    console.log(
      `${stdoutLabel} ${command}\n${rawStdout.length > 0 ? rawStdout : "<empty>"}\n`,
    );
    console.log(
      `${stderrLabel} ${command}\n${rawStderr.length > 0 ? rawStderr : "<empty>"}\n`,
    );

    if (execution.errorMessage) {
      console.log(`[checks] Setup error ${command}\n${execution.errorMessage}\n`);
    }
  }
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
