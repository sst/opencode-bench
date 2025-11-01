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

// Custom fetch with focused error logging and extended timeout
const customFetch = async (request: Request): Promise<Response> => {
  const startTime = Date.now();

  try {
    // Create AbortController with 25-minute timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1_500_000);

    try {
      const response = await fetch(request, { signal: controller.signal });
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      // Only log non-OK responses or slow requests
      if (!response.ok || duration > 60000) {
        console.error(
          `[opencode] Request to ${request.url} - Status: ${response.status}, Duration: ${duration}ms`,
        );

        if (!response.ok) {
          try {
            const clonedResponse = response.clone();
            const responseText = await clonedResponse.text();
            console.error(`[opencode] Full error response body:`, responseText);
          } catch (e) {
            console.error(`[opencode] Could not read error response body`);
          }
        }
      }

      return response;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[opencode] FETCH FAILED - URL: ${request.url}, Duration: ${duration}ms`,
    );

    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[opencode] Error: Request timed out after 25 minutes`);
    } else {
      console.error(
        `[opencode] Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (error instanceof Error && error.stack) {
      console.error(`[opencode] Stack:`, error.stack);
    }

    throw error;
  }
};

const opencodePort = await detectPort(4096);

// Set OpenCode config before server starts to ensure timeout is applied
const opencodeConfig = {
  permission: DEFAULT_PERMISSION_CONFIG,
  provider: {
    opencode: {
      options: {
        timeout: false as const, // Disable timeout for OpenCode provider requests
      },
    },
  },
};

// Set via environment variable to ensure it's picked up by the server
process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(opencodeConfig);

const opencode = await createOpencode({
  port: opencodePort,
  timeout: 1_500_000, // 25 minutes timeout for server startup
  config: opencodeConfig,
});

const sessionCache = new Map<string, string>();

export const models: string[] = [
  // "opencode/gpt-5",
  "opencode/gpt-5-codex",
  // "opencode/claude-sonnet-4-5",
  // "opencode/big-pickle",
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

function logPromptResult(
  result: { info: AssistantMessage; parts: Part[] },
  options: AgentRunOptions | undefined,
  logs?: string[],
): void {
  logJson({ info: result.info }, options);
  if (Array.isArray(result.parts)) {
    result.parts.forEach((part) => logJson(part, options));
  } else {
    logError(
      {
        error: "invalid_parts_array",
        message: `Expected 'parts' to be an array, but got ${typeof result.parts}`,
        receivedResponse: result,
      },
      options,
    );
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

      const { data } = await opencode.client.session.prompt({
        path: { id: sessionID! },
        query: { directory: cwd },
        body: {
          model: {
            providerID,
            modelID,
          },
          parts: [{ type: "text", text: prompt }],
        },
        throwOnError: true,
        fetch: customFetch,
      });

      if (data.info?.tokens) {
        usage.input = data.info.tokens.input || 0;
        usage.output = data.info.tokens.output || 0;
      } else {
        console.error(
          `[opencode] WARNING: No token usage in response. Available fields: ${Object.keys(data.info || {}).join(", ")}`,
        );
      }

      actions.push(JSON.stringify(data.info));
      if (Array.isArray(data.parts)) {
        data.parts.forEach((part) => actions.push(JSON.stringify(part)));
      }

      logPromptResult(data, options);
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
