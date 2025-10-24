import { strict as assert } from "node:assert";
import process from "node:process";

import { query } from "@anthropic-ai/claude-agent-sdk";

import type {
  AgentDefinition,
  AgentRunOptions,
  AgentRunResult,
} from "~/lib/createAgent.js";

export const models: string[] = [
  "claude-sonnet-4-5",
  // "claude-sonnet-4",
  // "claude-opus-4-1",
  // "claude-3-5-haiku",
];

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

    try {
      const result = query({
        prompt,
        options: {
          model,
          cwd,
          // Allow all tools by default, similar to other agents
          allowedTools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash"],
        },
      });

      // Stream and log messages
      for await (const message of result) {
        logJson(message, options);
      }
    } catch (error) {
      logError(
        {
          error: "claude_agent_sdk_failed",
          details: serializeError(error),
        },
        options,
      );
      throw error;
    }

    return { command: displayCommand };
  },
};

export default claudeCodeAgent;
