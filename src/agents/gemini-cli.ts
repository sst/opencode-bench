import process from "node:process";
import { spawn } from "node:child_process";
import type { Agent } from "./index.js";

const sessionCache = new Map<string, true>();
const GEMINI_CLI_PACKAGE = "@google/gemini-cli@0.22.5";

export const models = [
  // Gemini 2.0
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-pro",
  // Gemini 1.5
  "gemini-1.5-flash",
  "gemini-1.5-pro",
] as const;

function sessionKey(model: string, cwd: string): string {
  return `${cwd}::${model}`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      error: "serialization_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function logJson(value: unknown, options: Agent.RunOptions): void {
  process.stdout.write(`${options.logger.format(safeJsonStringify(value))}\n`);
}

function logError(value: unknown, options: Agent.RunOptions): void {
  process.stderr.write(`${options.logger.format(safeJsonStringify(value))}\n`);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
}

type GeminiCliStreamEvent =
  | {
      type: "init";
      timestamp: string;
      session_id: string;
      model: string;
    }
  | {
      type: "message";
      timestamp: string;
      role: "user" | "assistant";
      content: string;
      delta?: boolean;
    }
  | {
      type: "tool_use";
      timestamp: string;
      tool_name: string;
      tool_id: string;
      parameters?: unknown;
    }
  | {
      type: "tool_result";
      timestamp: string;
      tool_id: string;
      status: "success" | "error";
      output?: string;
      error?: { type: string; message: string };
    }
  | {
      type: "error";
      timestamp: string;
      severity: "warning" | "error";
      message: string;
    }
  | {
      type: "result";
      timestamp: string;
      status: "success" | "error";
      stats?: {
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        cached?: number;
        input?: number;
        duration_ms?: number;
        tool_calls?: number;
      };
    };

async function runGeminiCliOnce(
  model: string,
  prompt: string,
  options: Agent.RunOptions,
  resume: boolean,
): Promise<Agent.RunResult> {
  const args = [
    "--yes",
    GEMINI_CLI_PACKAGE,
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--model",
    model,
    ...(resume ? ["--resume", "latest"] : []),
    prompt,
  ];

  const child = spawn("npx", args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const actions: string[] = [];
  const usage = {
    input: 0,
    output: 0,
    cost: 0,
  };

  let stderr = "";
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const handleStdoutChunk = (chunk: Buffer | string) => {
    stdoutBuffer += chunk.toString();
    while (true) {
      const idx = stdoutBuffer.indexOf("\n");
      if (idx < 0) break;
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (!line.trim()) continue;

      // Gemini CLI stream-json is JSONL.
      try {
        const event = JSON.parse(line) as GeminiCliStreamEvent;
        actions.push(safeJsonStringify(event));
        logJson(event, options);

        if (event.type === "result" && event.stats) {
          usage.input += event.stats.input_tokens ?? 0;
          usage.output += event.stats.output_tokens ?? 0;
          // Gemini CLI does not currently emit cost in stream-json output.
        }
      } catch {
        // Keep raw output if parsing fails.
        actions.push(line);
        logJson({ type: "gemini_cli_raw", line }, options);
      }
    }
  };

  child.stdout?.on("data", handleStdoutChunk);
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;

    // Stream stderr through the benchmark logger (helpful for auth errors).
    stderrBuffer += text;
    while (true) {
      const idx = stderrBuffer.indexOf("\n");
      if (idx < 0) break;
      const line = stderrBuffer.slice(0, idx);
      stderrBuffer = stderrBuffer.slice(idx + 1);
      if (!line.trim()) continue;
      logError({ type: "gemini_cli_stderr", line }, options);
    }
  });

  const exit = await new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    },
  );

  // Flush any remaining partial line.
  if (stdoutBuffer.trim().length > 0) {
    handleStdoutChunk("\n");
  }

  if (exit.code !== 0) {
    const err = new Error(
      `Gemini CLI exited with code ${exit.code}${exit.signal ? ` (signal ${exit.signal})` : ""}`,
    );
    logError(
      {
        error: "gemini_cli_failed",
        details: {
          ...serializeError(err),
          stderr: stderr.trim().slice(0, 20_000),
        },
      },
      options,
    );
    throw err;
  }

  return { actions, usage };
}

const geminiCliAgent: Agent.Definition<(typeof models)[number]> = {
  async run(model, prompt, options) {
    options.logger.log(
      `gemini-cli (via npx) --model ${model} --output-format stream-json --approval-mode yolo`,
    );

    const cacheKey = sessionKey(model, options.cwd);
    const resume = sessionCache.has(cacheKey);

    try {
      const result = await runGeminiCliOnce(model, prompt, options, resume);
      sessionCache.set(cacheKey, true);
      return result;
    } catch (error) {
      sessionCache.delete(cacheKey);
      throw error;
    }
  },
};

export default geminiCliAgent;

