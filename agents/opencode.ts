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

// Custom fetch with extended timeout and better error handling
const customFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init?.method || "GET";
  const startTime = Date.now();

  // Log request details
  console.error(`[opencode] ============ FETCH REQUEST START ============`);
  console.error(`[opencode] ${method} ${url}`);
  console.error(`[opencode] Timeout: 600000ms (10 minutes)`);

  if (init?.headers) {
    console.error(`[opencode] Request Headers:`);
    const headers = init.headers;
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        console.error(`[opencode]   ${key}: ${key.toLowerCase().includes('auth') || key.toLowerCase().includes('key') ? '***REDACTED***' : value}`);
      });
    } else if (typeof headers === "object") {
      Object.entries(headers).forEach(([key, value]) => {
        console.error(`[opencode]   ${key}: ${key.toLowerCase().includes('auth') || key.toLowerCase().includes('key') ? '***REDACTED***' : value}`);
      });
    }
  } else {
    console.error(`[opencode] Request Headers: none`);
  }

  if (init?.body) {
    const bodyStr = typeof init.body === "string" ? init.body : String(init.body);
    console.error(`[opencode] Request Body Length: ${bodyStr.length} bytes`);
    // Don't log full body to avoid sensitive data, but show a preview
    if (bodyStr.length < 500) {
      console.error(`[opencode] Request Body Preview: ${bodyStr.substring(0, 200)}...`);
    }
  }

  try {
    // Extend timeout to 10 minutes for long-running LLM requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      const duration = Date.now() - startTime;
      console.error(`[opencode] ⏱️  REQUEST TIMEOUT after ${duration}ms`);
      controller.abort();
    }, 600_000); // 10 minutes

    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    console.error(`[opencode] ============ FETCH RESPONSE ============`);
    console.error(`[opencode] Status: ${response.status} ${response.statusText}`);
    console.error(`[opencode] Duration: ${duration}ms`);

    // Log response headers
    console.error(`[opencode] Response Headers:`);
    response.headers.forEach((value, key) => {
      console.error(`[opencode]   ${key}: ${value}`);
    });

    if (!response.ok) {
      const responseText = await response.clone().text().catch(() => "Unable to read body");
      console.error(`[opencode] ❌ HTTP ${response.status} Response Body:`);
      console.error(responseText.substring(0, 1000));
    } else {
      console.error(`[opencode] ✅ Request successful`);
    }

    console.error(`[opencode] ============ FETCH REQUEST END ============`);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[opencode] ============ FETCH ERROR ============`);
    console.error(`[opencode] ❌ Fetch failed for ${method} ${url}`);
    console.error(`[opencode] Duration: ${duration}ms`);
    console.error(`[opencode] Error Type: ${error instanceof Error ? error.name : typeof error}`);
    console.error(`[opencode] Error Message: ${error instanceof Error ? error.message : String(error)}`);

    if (error instanceof Error && error.stack) {
      console.error(`[opencode] Error Stack:`);
      console.error(error.stack);
    }

    if (error && typeof error === "object" && "cause" in error) {
      console.error(`[opencode] Error Cause:`, error.cause);
    }

    console.error(`[opencode] ============ FETCH ERROR END ============`);
    throw error;
  }
};

const opencodePort = await detectPort(4096);

const opencode = await createOpencode({
  port: opencodePort,
  config: {
    permission: DEFAULT_PERMISSION_CONFIG,
  },
  fetch: customFetch,
});
process.once("beforeExit", () => opencode.server.close());

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
      console.error(`[opencode] Creating new session for ${cacheKey} in directory ${cwd}`);
      const sessionStartTime = Date.now();
      const { data: session } = await opencode.client.session.create({
        query: { directory: cwd },
        throwOnError: true,
      });
      const sessionDuration = Date.now() - sessionStartTime;
      sessionID = session.id;
      sessionCache.set(cacheKey, sessionID);
      console.error(`[opencode] Session created with ID ${sessionID} in ${sessionDuration}ms`);
    } else {
      console.error(`[opencode] Reusing cached session ${sessionID} for ${cacheKey}`);
    }

    const actions: string[] = [];
    const usage = {
      input: 0,
      output: 0,
    };
    try {
      const [providerID, modelID] = model.split("/");
      console.error(`[opencode] Sending prompt to session ${sessionID} with model ${providerID}/${modelID}`);
      console.error(`[opencode] Prompt length: ${prompt.length} characters`);
      console.error(`[opencode] Working directory: ${cwd}`);

      const promptStartTime = Date.now();
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
      });
      const promptDuration = Date.now() - promptStartTime;

      console.error(`[opencode] Prompt completed in ${promptDuration}ms`);
      console.error(`[opencode] Response parts count: ${Array.isArray(data.parts) ? data.parts.length : 'invalid'}`);
      console.error(`[opencode] Token usage: input=${data.info.tokens.input}, output=${data.info.tokens.output}`);

      usage.input = data.info.tokens.input;
      usage.output = data.info.tokens.output;

      actions.push(JSON.stringify(data.info));
      if (Array.isArray(data.parts)) {
        data.parts.forEach((part) => actions.push(JSON.stringify(part)));
      }

      logPromptResult(data, options);
    } catch (error) {
      console.error(`[opencode] Error occurred during prompt execution for session ${sessionID}`);
      console.error(`[opencode] Model: ${model}, CWD: ${cwd}`);
      console.error(`[opencode] Error details:`, serializeError(error));
      console.error(`[opencode] Clearing session cache for ${cacheKey}`);

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
};

export default opencodeAgent;
