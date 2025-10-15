import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";
import { z } from "zod";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const commandConfigSchema = z.object({
  setup: z.array(z.string().min(1)).default([]),
  commands: z
    .array(z.string().min(1))
    .min(1, "At least one check command is required."),
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

IMPORTANT: You must select exactly ONE of these discrete scores: 0, 0.25, 0.5, 0.75, or 1.0. Do not use intermediate values.
When borderline between two levels, round UP to the higher score if the overall trajectory shows effort toward maintaining/improving health.

Scoring rubric:

1.0 - Perfect Health
- Every previously passing check still passes
- No new failures introduced
- Exit codes remain 0 where they were 0
- No increase in errors/warnings
Examples:
  • Baseline: 5 tests pass, 0 fail | After: 5 tests pass, 0 fail
  • Baseline: build exits 0 | After: build exits 0
  • Baseline: 2 tests fail, 8 pass | After: 2 tests still fail (same errors), 8 pass

0.75 - Improved, No Regressions
- All previously passing checks still pass (no regressions)
- Previously failing checks show improvement (fewer errors, better exit codes, reduced failure count)
- Overall health better or equal
Examples:
  • Baseline: 8 tests pass, 2 fail (20 assertions fail) | After: 8 tests pass, 2 fail (10 assertions fail)
  • Baseline: build succeeds, lint fails with 50 errors | After: build succeeds, lint fails with 30 errors
  • Baseline: type check exits 1 (15 errors) | After: type check exits 1 (8 errors), all other checks unchanged
  • Baseline: 5 pass, 3 fail | After: 7 pass, 1 fail (net improvement)

0.5 - Status Quo Maintained
- No previously passing checks now fail
- No improvements to failing checks (or minimal change)
- Neutral outcome: maintained baseline health
Examples:
  • Baseline: 6 tests pass, 2 fail | After: 6 tests pass, 2 fail (same error messages)
  • Baseline: build exits 0, lint exits 1 | After: build exits 0, lint exits 1 (same warnings)
  • Baseline: 15 tests pass | After: 15 tests pass (no changes)
  • Baseline: 3 checks fail with 10 errors each | After: 3 checks fail with 9-11 errors each (negligible change)

0.25 - Minor Regressions
- One or two previously passing checks now fail
- Or: Multiple checks show degraded performance (higher error counts, worse exit codes)
- Majority of health maintained but clear regressions present
Examples:
  • Baseline: 10 tests pass | After: 8 tests pass, 2 now fail
  • Baseline: lint exits 0 | After: lint exits 1 (5 new errors introduced)
  • Baseline: build exits 0, 8 tests pass | After: build exits 0, 6 tests pass
  • Baseline: 5 checks pass | After: 4 checks pass, 1 now times out

0.0 - Critical Failures
- Multiple previously passing checks now fail
- New critical failures introduced (build broken, major tests failing)
- Severe degradation across the board
Examples:
  • Baseline: All 12 tests pass | After: 10 tests fail, 2 pass
  • Baseline: build exits 0 | After: build exits 1 (compilation error), can't run tests
  • Baseline: All checks pass | After: Multiple checks fail (lint, test, type check all broken)
  • Baseline: 5 checks pass | After: All 5 checks now fail or error out

Grade each command, then choose the overall score that best represents the combined outcome. Always mention the key facts (exit codes, failure counts, new vs removed errors) in your rationale so the reasoning is transparent.

Return JSON with 'score' (must be exactly one of: 0, 0.25, 0.5, 0.75, 1.0) and a concise rationale.`;

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

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
        baseline,
      };
    });

    assert(
      results.length > 0,
      `Score "checks" requires at least one command for ${evaluation.repo}.`,
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
        prompt,
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Checks score evaluation failed: ${message}`,
      };
    }
  },
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
      CI: process.env.CI ?? "1",
    },
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
    errorMessage,
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
        `After agent: ${after}`,
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
  const stdout = execution.stdout?.trim() ?? "";
  const stderr = execution.stderr?.trim() ?? "";
  const error = execution.errorMessage
    ? ` error: ${execution.errorMessage}`
    : "";

  return `${status} (${exitInfo}, ${duration})${error}\nstdout: ${stdout.length > 0 ? stdout : "<empty>"}\nstderr: ${stderr.length > 0 ? stderr : "<empty>"}`;
}

function logExecution(
  stage: "baseline" | "after",
  command: string,
  execution: CommandExecution,
): void {
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
      console.log(
        `[checks] Setup error ${command}\n${execution.errorMessage}\n`,
      );
    }
  }
}
