import { strict as assert } from "node:assert";
import process, { cwd } from "node:process";

import { query } from "@anthropic-ai/claude-agent-sdk";

import type { Agent } from "./index.js";
import { Logger } from "../util/logger.js";

const sessionCache = new Map<string, string>();

export const models: string[] = [
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  // "claude-sonnet-4",
  // "claude-opus-4-1",
  // "claude-3-5-haiku",
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

const claudeCodeAgent: Agent.Definition = {
  async run(model, prompt, options) {
    options.logger.log(`claude-agent-sdk --model ${model} ${prompt}`);

    const cacheKey = sessionKey(model, options.cwd);
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
          cwd: options.cwd,
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

    return { actions, usage };
  },
};

export default claudeCodeAgent;
