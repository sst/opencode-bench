import { strict as assert } from "node:assert";
import process from "node:process";

import { query } from "@anthropic-ai/claude-agent-sdk";

import type {
  AgentDefinition,
  AgentRunOptions,
  AgentRunResult,
} from "~/lib/createAgent.js";

const sessionCache = new Map<string, string>();

export const models: string[] = [
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  // "claude-sonnet-4",
  // "claude-opus-4-1",
  // "claude-3-5-haiku",
];

function sessionKey(cwd: string, model: string): string {
  return `${cwd}::${model}`;
}

function formatCommand(command: string, args: string[]): string {
  if (args.length === 0) {
    return command;
  }

  const rendered = args.map((arg) =>
    /[\s"']/.test(arg) ? JSON.stringify(arg) : arg,
  );

  return `${command} ${rendered.join(" ")}`;
}

function writeLog(
  output: NodeJS.WriteStream,
  message: string,
  prefix: string | undefined,
): void {
  if (prefix) {
    output.write(`[${prefix}] ${message}\n`);
  } else {
    output.write(`${message}\n`);
  }
}

function logJson(value: unknown, options: AgentRunOptions | undefined): void {
  try {
    writeLog(process.stdout, JSON.stringify(value), options?.logPrefix);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeLog(
      process.stdout,
      JSON.stringify({ error: "serialization_failed", reason }),
      options?.logPrefix,
    );
  }
}

function logError(value: unknown, options: AgentRunOptions | undefined): void {
  try {
    writeLog(process.stderr, JSON.stringify(value), options?.logPrefix);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeLog(
      process.stderr,
      JSON.stringify({ error: "serialization_failed", reason }),
      options?.logPrefix,
    );
  }
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

const claudeCodeAgent: AgentDefinition = {
  async run(
    model: string,
    prompt: string,
    cwd: string,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    assert(
      typeof prompt === "string",
      "Claude Code agent requires a prompt string.",
    );

    const displayCommand = formatCommand("claude-agent-sdk", [
      "--model",
      model,
      prompt,
    ]);

    options?.onStart?.(displayCommand);

    const cacheKey = sessionKey(cwd, model);
    const existingSessionID = sessionCache.get(cacheKey);

  const actions: string[] = [];
  const usage = {
    input: 0,
    output: 0,
    cost: 0,
  };

    try {
      const result = query({
        prompt,
        options: {
          model,
          cwd,
          // Resume existing session if available
          ...(existingSessionID ? { resume: existingSessionID } : {}),
          allowedTools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"],
        },
      });

      // Stream and log messages
      for await (const message of result) {
        // Extract and cache session ID from messages
        sessionCache.set(cacheKey, message.session_id);

        // Accumulate token usage if available (only SDKResultMessage has usage)
        if (message.type === "result" && "usage" in message) {
          usage.input += message.usage.input_tokens || 0;
          usage.output += message.usage.output_tokens || 0;
          usage.cost += message.total_cost_usd || 0;
        }

        actions.push(JSON.stringify(message));
        logJson(message, options);
      }
    } catch (error) {
      // Clear session cache on error, like other agents do
      sessionCache.delete(cacheKey);
      logError(
        {
          error: "claude_agent_sdk_failed",
          details: serializeError(error),
        },
        options,
      );
      throw error;
    }

    return { command: displayCommand, actions, usage };
  },
};

export default claudeCodeAgent;
