import { strict as assert } from "node:assert";
import process from "node:process";

import detectPort from "detect-port";

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

const DEFAULT_FETCH_TIMEOUT_MS = 45 * 60 * 1000; // 40 minute episode limit + 5 minute buffer

const opencodePort = await detectPort(4096);

// Set OpenCode config before server starts to ensure timeout is applied
const opencodeConfig = {
  permission: DEFAULT_PERMISSION_CONFIG,
  share: "auto",
  provider: {
    opencode: {
      options: {
        timeout: false as false, // Disable timeout for OpenCode provider requests
      },
    },
  },
} satisfies OpencodeConfig;

// CRITICAL: Set via environment variable BEFORE importing/creating anything
// The SDK reads this when spawning the server process
const configJson = JSON.stringify(opencodeConfig);
process.env.OPENCODE_CONFIG_CONTENT = configJson;

console.error(`[opencode] Setting config: ${configJson}`);

const opencode = await createOpencode({
  port: opencodePort,
  timeout: 1_500_000, // 25 minutes timeout for server startup
  config: opencodeConfig,
});

const sessionCache = new Map<string, string>();

export const models: string[] = [
  "opencode/gpt-5-codex",
  "opencode/gpt-5.1-codex",
  "opencode/claude-sonnet-4-5",
  "opencode/claude-opus-4-5",
  "opencode/glm-4.6",
  "opencode/gemini-3-pro",
  "opencode/qwen3-coder",
  "opencode/kimi-k2",
  "opencode/grok-code",
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
    const message = JSON.stringify(value);
    writeLog(process.stdout, message, options?.logPrefix);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const errorMessage = JSON.stringify({
      error: "serialization_failed",
      reason,
    });
    writeLog(process.stdout, errorMessage, options?.logPrefix);
  }
}

function logError(value: unknown, options: AgentRunOptions | undefined): void {
  try {
    const message = JSON.stringify(value);
    writeLog(process.stderr, message, options?.logPrefix);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const errorMessage = JSON.stringify({
      error: "serialization_failed",
      reason,
    });
    writeLog(process.stderr, errorMessage, options?.logPrefix);
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? serializeError(error.cause) : undefined,
    };
  }
  if (typeof error === "object" && error !== null) {
    return { ...error };
  }
  return { value: String(error) };
}

function sessionKey(cwd: string, model: string): string {
  return `${cwd}::${model}`;
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

    const displayCommand = formatCommand("opencode", [
      "--model",
      model,
      prompt,
    ]);

    options?.onStart?.(displayCommand);

    const cacheKey = sessionKey(cwd, model);

    let sessionID = sessionCache.get(cacheKey);
    if (!sessionID) {
      const { data: session } = await opencode.client.session.create({
        query: { directory: cwd },
        throwOnError: true,
      });
      sessionID = session.id;
      sessionCache.set(cacheKey, sessionID);
    }

    const actions: string[] = [];
    const usage = {
      input: 0,
      output: 0,
    };
    try {
      const [providerID, modelID] = model.split("/");

      const { data, error } = await opencode.client.session.prompt({
        path: { id: sessionID! },
        query: { directory: cwd },
        body: {
          model: {
            providerID,
            modelID,
          },
          parts: [{ type: "text", text: prompt }],
        },
      });

      if (error) {
        throw error;
      }

      const info = data.info;
      usage.input = info?.tokens?.input ?? 0;
      usage.output = info?.tokens?.output ?? 0;

      if (info) {
        actions.push(JSON.stringify(info));
      }

      const parts = Array.isArray(data.parts) ? data.parts : null;
      assert(
        parts && parts.length > 0,
        "OpenCode response did not include any assistant parts.",
      );
      parts.forEach((part) => actions.push(JSON.stringify(part)));

      if (info) {
        logJson({ info }, options);
      }
      parts.forEach((part) => logJson(part, options));

      try {
        const { data: sharedSession, error: shareError } =
          await opencode.client.session.share({
            path: { id: sessionID! },
            query: { directory: cwd },
          });
        if (shareError) {
          throw shareError;
        }

        const shareUrl = sharedSession.share?.url;
        if (shareUrl) {
          logJson({ shareUrl }, options);
        }
      } catch (shareError) {
        console.error(
          `[opencode] Failed to enable sharing for session ${sessionID}:`,
          shareError instanceof Error
            ? shareError.message
            : String(shareError),
        );
      }
    } catch (error) {
      console.error(
        `[opencode] Error in ${model}:`,
        error instanceof Error ? error.message : String(error),
      );
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

    return { command: displayCommand, actions, usage };
  },
  cleanup() {
    opencode.server.close();
  },
};

export default opencodeAgent;
