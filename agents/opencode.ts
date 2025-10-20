import { strict as assert } from "node:assert";
import process from "node:process";

import {
  createOpencode,
  type AssistantMessage,
  type Config as OpencodeConfig,
  type Part,
} from "@opencode-ai/sdk";

import type {
  AgentDefinition,
  AgentRunOptions,
  AgentRunResult,
} from "~/lib/createAgent.js";

const DEFAULT_PERMISSION_CONFIG: NonNullable<OpencodeConfig["permission"]> = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
};

const opencode = await createOpencode({
  config: {
    permission: DEFAULT_PERMISSION_CONFIG,
  },
});
process.once("beforeExit", opencode.server.close);

const sessionCache = new Map<string, string>();

export const models: string[] = [
  // "opencode/gpt-5",
  "opencode/gpt-5-codex",
  "opencode/claude-sonnet-4-5",
  // "opencode/claude-sonnet-4",
  // "opencode/claude-3-5-haiku",
  // "opencode/claude-opus-4-1",
  // "opencode/qwen3-coder",
  // "opencode/grok-code",
  // "opencode/kimi-k2",
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

function parseModel(model: string): { providerID: string; modelID: string } {
  if (model.includes("/")) {
    const [providerID, modelID] = model.split("/", 2);
    assert(providerID && modelID, "Invalid opencode model identifier.");
    return { providerID, modelID };
  }

  return { providerID: "opencode", modelID: model };
}

function unwrapResult<T>(input: T | { data: T }): T {
  if (input && typeof input === "object" && "data" in input) {
    return (input as { data: T }).data;
  }
  return input;
}

function logPromptResult(
  result: { info: AssistantMessage; parts: Part[] },
  options: AgentRunOptions | undefined,
): void {
  logJson({ info: result.info }, options);
  result.parts.forEach((part) => logJson(part, options));
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

function sessionKey(cwd: string, providerID: string, modelID: string): string {
  return `${cwd}::${providerID}/${modelID}`;
}

const opencodeAgent: AgentDefinition = {
  async run(
    model: string,
    prompt: string,
    cwd: string,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    assert(
      typeof prompt === "string",
      "Opencode agent requires a prompt string.",
    );

    const { providerID, modelID } = parseModel(model);
    const displayCommand = formatCommand("opencode-sdk", [
      "--provider",
      providerID,
      "--model",
      modelID,
      prompt,
    ]);

    options?.onStart?.(displayCommand);

    const cacheKey = sessionKey(cwd, providerID, modelID);

    let sessionID = sessionCache.get(cacheKey);
    if (!sessionID) {
      const session = await opencode.client.session.create({
        query: { directory: cwd },
        responseStyle: "data",
        throwOnError: true,
      });
      sessionID = unwrapResult(session).id;
      sessionCache.set(cacheKey, sessionID);
    }

    try {
      const promptResponse = await opencode.client.session.prompt({
        path: { id: sessionID },
        query: { directory: cwd },
        body: {
          model: {
            providerID,
            modelID,
          },
          parts: [{ type: "text", text: prompt }],
        },
        responseStyle: "data",
        throwOnError: true,
      });

      const result = unwrapResult(promptResponse);
      logPromptResult(result, options);
    } catch (error) {
      sessionCache.delete(cacheKey);
      logError(
        {
          error: "opencode_prompt_failed",
          details: serializeError(error),
        },
        options,
      );
      throw error;
    }

    return { command: displayCommand };
  },
};

export default opencodeAgent;
