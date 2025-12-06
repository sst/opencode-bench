import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";
import { z } from "zod";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";
import { Logger } from "~/lib/logger.js";

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

const systemPrompt = `You are a STRICT evaluator determining whether an autonomous agent introduced regressions to project checks.

**YOUR ROLE**: Find problems, not excuse them. Default to FAIL if any previously passing check now fails.
**YOUR STANDARD**: Zero tolerance for regressions. Any degradation from baseline = FAIL.
**WHEN IN DOUBT**: If exit codes are unclear or behavior seems worse → FAIL. Better to be strict than lenient.

For each command you see:
- Baseline → how the check behaved before the agent ran.
- After agent → how it behaves afterwards.

IMPORTANT: You must give a BINARY score - either 0 (FAIL) or 1 (PASS). No intermediate values allowed.

Binary Scoring Rubric:

**1 (PASS)** - No Regressions Detected
The agent maintained or improved the baseline health. Every check that passed before still passes.
- All previously passing checks still pass (same or better exit codes)
- No new failures introduced
- Previously failing checks may have improved, stayed the same, or gotten slightly worse (this is acceptable)
- The key criterion: did any previously passing check start failing? If NO → PASS

Examples of PASS:
  • Baseline: 10 tests pass, 2 fail | After: 10 tests still pass, 2 still fail (maintained)
  • Baseline: build exits 0, lint exits 0 | After: build exits 0, lint exits 0 (maintained)
  • Baseline: 8 pass, 2 fail | After: 10 pass, 0 fail (improved)
  • Baseline: build exits 0, 5 tests pass, 3 fail | After: build exits 0, 5 tests pass, 3 fail
  • Baseline: All checks pass | After: All checks pass
  • Baseline: 3 checks fail | After: 2 checks fail (improvement)

**0 (FAIL)** - Regressions Detected
The agent introduced regressions. At least one check that previously passed now fails.
- One or more previously passing checks now fail
- Exit codes degraded (0 → non-zero for previously passing commands)
- New critical failures (build broken, tests that passed now fail)
- The key criterion: did any previously passing check start failing? If YES → FAIL

Examples of FAIL:
  • Baseline: 10 tests pass | After: 8 tests pass, 2 now fail (regression)
  • Baseline: build exits 0 | After: build exits 1 (regression)
  • Baseline: All checks pass | After: 1 check now fails (regression)
  • Baseline: lint exits 0 | After: lint exits 1 with errors (regression)
  • Baseline: 12 tests pass, 2 fail | After: 10 tests pass, 4 fail (2 tests regressed)

**Common Pitfalls to Avoid** (These lead to false positives - don't fall for them!):
- **"Only one test regressed"** → NO. Even one regressed test = FAIL. Zero tolerance for regressions.
- **"The new failures are minor"** → NO. Any previously passing check that now fails = FAIL, regardless of severity.
- **"More tests now pass overall"** → Irrelevant. If ANY previously passing test now fails, it's FAIL.
- **"Exit code changed from 0 to 1 but stderr is empty"** → Still FAIL. Exit codes are the source of truth.
- **"The agent improved most checks"** → Doesn't matter. One regression = FAIL.
- **"It's flaky, might pass on retry"** → We judge what we see. If it failed in after-agent run = FAIL.
- **"The baseline was already barely passing"** → Irrelevant. Did a passing check start failing? That's the only question.

**MANDATORY Decision Process** (Complete ALL steps in order):

Step 1: **Baseline Check Inventory**
- List ALL checks and their baseline status (pass/fail, exit codes)
- Identify which checks were passing (exit code 0) in baseline
- Identify which checks were failing (exit code ≠ 0) in baseline

Step 2: **After-Agent Check Inventory**
- List ALL checks and their after-agent status (pass/fail, exit codes)
- Identify which checks are passing (exit code 0) after agent
- Identify which checks are failing (exit code ≠ 0) after agent

Step 3: **Regression Detection**
- For EACH baseline-passing check: Did it remain passing after agent?
- List ANY checks that were passing (exit 0) but now fail (exit ≠ 0)
- If ANY such regressions exist → Note them for FAIL decision

Step 4: **Exit Code Analysis**
- Compare baseline vs after-agent exit codes for each check
- Note any exit code degradations (0 → non-zero)
- Note any exit code improvements (non-zero → 0) - these are acceptable

Step 5: **Final Decision**
- ALL previously passing checks still pass? ✓ or ✗
- NO new failures introduced? ✓ or ✗
- If BOTH checkmarks → score = 1 (PASS)
- If ANY missing → score = 0 (FAIL)

Step 6: **Detailed Rationale**
- Document findings from each step
- Cite specific exit codes, test counts, error messages
- Justify pass/fail decision with concrete evidence
- The key criterion: did ANY previously passing check start failing?

Always mention the key facts (exit codes, failure counts, new vs removed errors) in your rationale so the reasoning is transparent.

Return JSON with 'score' (must be exactly 0 or 1) and a detailed rationale explaining your decision.`;

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

type ChecksConfig = z.infer<typeof commandConfigSchema>;

export default createScore<PreparedCheck[], ChecksConfig>({
  prepare: async ({ cwd, evaluation, config, logger }) => {
    const parsedConfig = commandConfigSchema.parse(config ?? {});

    for (const command of parsedConfig.setup) {
      const result = await runCommand(command, cwd);
      logSetupExecution(command, result, logger);
    }

    const results: PreparedCheck[] = [];

    for (const command of parsedConfig.commands) {
      const baseline = await runCommand(command, cwd);
      logExecution("baseline", command, baseline, logger);
      results.push({ command, baseline });
    }

    assert(
      results.length > 0,
      `Score "checks" requires at least one command for ${evaluation.repo}.`,
    );

    return results;
  },
  evaluate: async ({
    evaluation,
    cwd,
    judge,
    reference,
    config: _config,
    logger,
  }) => {
    finalizeAgentChanges(evaluation, cwd, evaluation.from);

    for (const entry of reference) {
      if (!entry.after) {
        entry.after = await runCommand(entry.command, cwd);
        logExecution("after", entry.command, entry.after, logger);
      }
    }

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

async function runCommand(
  command: string,
  cwd: string,
): Promise<CommandExecution> {
  const start = Date.now();

  return await new Promise<CommandExecution>((resolve) => {
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

    const finalize = (exitCode: number | null) => {
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
    };

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
      finalize(exitCode);
    });
  });
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

  return `${status} (${exitInfo}, ${duration})${error}\nstdout: ${
    stdout.length > 0 ? stdout : "<empty>"
  }\nstderr: ${stderr.length > 0 ? stderr : "<empty>"}`;
}

function formatExecutionForLog(execution: CommandExecution): string {
  const status = execution.success ? "PASS" : "FAIL";
  const exitInfo =
    execution.exitCode !== null ? `exit ${execution.exitCode}` : "no exit code";
  const duration = `${execution.runtimeMs}ms`;
  const error = execution.errorMessage
    ? ` error: ${execution.errorMessage}`
    : "";

  return `${status} (${exitInfo}, ${duration})${error}`;
}

function logExecution(
  stage: "baseline" | "after",
  command: string,
  execution: CommandExecution,
  logger: Logger.Instance,
): void {
  const header =
    stage === "baseline" ? "[checks] Baseline" : "[checks] After agent";
  const formatted = formatExecutionForLog(execution);
  logLines(logger, `${header} ${command}`);
  logLines(logger, formatted);
}

function logSetupExecution(
  command: string,
  execution: CommandExecution,
  logger: Logger.Instance,
): void {
  const formatted = formatExecutionForLog(execution);
  logLines(logger, `[checks] Setup ${command}`);
  logLines(logger, formatted);
}

function logLines(logger: Logger.Instance, message: string): void {
  const lines = message.split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    logger.log(line);
  }
}
