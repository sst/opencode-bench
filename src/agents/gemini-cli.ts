import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import process from "node:process";
import path from "node:path";

import type { Agent } from "./index.js";
import type {
  JsonStreamEvent,
  InitEvent,
  ResultEvent,
  StreamStats,
} from "@google/gemini-cli-core/dist/src/output/types.js";

// Re-export the enum since it's not exported from the types
enum JsonStreamEventType {
  INIT = "init",
  MESSAGE = "message",
  TOOL_USE = "tool_use",
  TOOL_RESULT = "tool_result",
  ERROR = "error",
  RESULT = "result",
}

const sessionCache = new Map<string, string>();

export const models: string[] = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
];

function sessionKey(model: string, cwd: string): string {
  return `${cwd}::${model}`;
}

function logJson(value: unknown, options: Agent.RunOptions): void {
  let message: string;
  try {
    message = JSON.stringify(value);
  } catch (error) {
    message = JSON.stringify({
      error: "serialization_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  process.stdout.write(`${options.logger.format(message)}\n`);
}

function logError(value: unknown, options: Agent.RunOptions): void {
  let message: string;
  try {
    message = JSON.stringify(value);
  } catch (error) {
    message = JSON.stringify({
      error: "serialization_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  process.stderr.write(`${options.logger.format(message)}\n`);
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

function findGeminiCLI(): string {
  // Look for gemini-cli in node_modules
  const localPath = path.join(
    process.cwd(),
    "node_modules",
    "@google",
    "gemini-cli",
    "dist",
    "index.js"
  );
  return localPath;
}

interface GeminiRunResult {
  actions: string[];
  usage: {
    input: number;
    output: number;
    cost: number;
  };
  sessionId?: string;
}

async function runGeminiCLI(
  model: string,
  prompt: string,
  options: Agent.RunOptions,
  resumeSessionId?: string
): Promise<GeminiRunResult> {
  const cliPath = findGeminiCLI();

  const args = [
    cliPath,
    "-p",
    prompt,
    "-m",
    model,
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo", // Auto-approve all tools for benchmarking
  ];

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  options.logger.log(`gemini-cli ${args.slice(1).join(" ")}`);

  return new Promise((resolve, reject) => {
    const childProcess: ChildProcess = spawn("node", args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        // Ensure we're using the right environment
        NODE_ENV: "production",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const actions: string[] = [];
    const usage = {
      input: 0,
      output: 0,
      cost: 0,
    };
    let sessionId: string | undefined;
    let hasError = false;
    let errorMessage = "";

    const readline: ReadlineInterface = createInterface({
      input: childProcess.stdout!,
      crlfDelay: Infinity,
    });

    readline.on("line", (line: string) => {
      if (!line.trim()) return;

      try {
        const event = JSON.parse(line) as JsonStreamEvent;
        actions.push(line);
        logJson(event, options);

        switch (event.type) {
          case JsonStreamEventType.INIT:
            sessionId = (event as InitEvent).session_id;
            break;

          case JsonStreamEventType.RESULT: {
            const resultEvent = event as ResultEvent;
            if (resultEvent.stats) {
              const stats: StreamStats = resultEvent.stats;
              usage.input = stats.input_tokens || 0;
              usage.output = stats.output_tokens || 0;
              // Calculate cost based on models.dev pricing
              // gemini-2.5-pro: $1.25/M input, $10/M output
              // gemini-2.5-flash: $0.30/M input, $2.50/M output
              const pricing = getModelPricing(model);
              const cachedTokens = stats.cached || 0;
              const billableInput = usage.input - cachedTokens;
              usage.cost =
                (billableInput * pricing.input +
                  usage.output * pricing.output +
                  cachedTokens * pricing.cache_read) /
                1_000_000;
            }
            if (resultEvent.status === "error" && resultEvent.error) {
              hasError = true;
              errorMessage = resultEvent.error.message;
            }
            break;
          }

          case JsonStreamEventType.ERROR:
            // Log but don't fail - the RESULT event will have the final status
            break;
        }
      } catch (parseError) {
        // Some lines might not be valid JSON (e.g., debug output)
        options.logger.debug(`Non-JSON output: ${line}`);
      }
    });

    // Capture stderr for debugging
    childProcess.stderr?.on("data", (data: Buffer) => {
      const stderr = data.toString();
      options.logger.debug(`stderr: ${stderr}`);
    });

    childProcess.on("error", (error: Error) => {
      reject(error);
    });

    childProcess.on("close", (code: number | null) => {
      readline.close();

      if (code !== 0 && code !== null) {
        if (hasError) {
          reject(new Error(`Gemini CLI exited with code ${code}: ${errorMessage}`));
        } else {
          reject(new Error(`Gemini CLI exited with code ${code}`));
        }
        return;
      }

      resolve({
        actions,
        usage,
        sessionId,
      });
    });
  });
}

interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
}

function getModelPricing(model: string): ModelPricing {
  // Pricing from models.dev (per million tokens)
  const pricing: Record<string, ModelPricing> = {
    "gemini-2.5-pro": {
      input: 1.25,
      output: 10,
      cache_read: 0.31,
    },
    "gemini-2.5-flash": {
      input: 0.3,
      output: 2.5,
      cache_read: 0.075,
    },
    "gemini-3-pro-preview": {
      input: 2,
      output: 12,
      cache_read: 0.2,
    },
    "gemini-3-flash-preview": {
      input: 0.5,
      output: 3,
      cache_read: 0.05,
    },
  };

  return (
    pricing[model] || {
      input: 1.25,
      output: 10,
      cache_read: 0.31,
    }
  );
}

const geminiCliAgent: Agent.Definition = {
  async run(model, prompt, options) {
    options.logger.log(`gemini-cli --model ${model} ${prompt}`);

    const cacheKey = sessionKey(model, options.cwd);
    const existingSessionID = sessionCache.get(cacheKey);

    try {
      const result = await runGeminiCLI(model, prompt, options, existingSessionID);

      // Cache session ID for future runs
      if (result.sessionId) {
        sessionCache.set(cacheKey, result.sessionId);
      }

      return {
        actions: result.actions,
        usage: result.usage,
      };
    } catch (error) {
      // Clear session cache on error
      sessionCache.delete(cacheKey);
      logError(
        {
          error: "gemini_cli_failed",
          details: serializeError(error),
        },
        options
      );
      throw error;
    }
  },
};

export default geminiCliAgent;
