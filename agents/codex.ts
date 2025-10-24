import { strict as assert } from "node:assert";
import process from "node:process";

import {
  Codex,
  type CommandExecutionItem,
  type SandboxMode,
  type Thread,
  type ThreadItem,
} from "@openai/codex-sdk";

import type {
  AgentDefinition,
  AgentRunOptions,
  AgentRunResult,
} from "~/lib/createAgent.js";

const DEFAULT_SANDBOX: SandboxMode = "workspace-write";

const codexClient = new Codex();
const threadCache = new Map<string, Thread>();

export const models: string[] = [
  "gpt-5-codex",
  "gpt-5",
  // "o3",
  // "o4-mini"
];

function sessionKey(cwd: string, model: string): string {
  return `${cwd}::${model}`;
}

function formatCommand(command: string, args: string[]): string {
  if (args.length === 0) {
    return command;
  }

  const renderedArgs = args.map((arg) =>
    /[\s"']/.test(arg) ? JSON.stringify(arg) : arg,
  );

  return `${command} ${renderedArgs.join(" ")}`;
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

function isCommandExecutionItem(
  item: ThreadItem,
): item is CommandExecutionItem {
  return item.type === "command_execution";
}

function logTurnItems(
  items: ThreadItem[],
  options: AgentRunOptions | undefined,
): void {
  for (const item of items) {
    try {
      writeLog(process.stdout, JSON.stringify(item), options?.logPrefix);
    } catch (error) {
      const fallback = isCommandExecutionItem(item)
        ? { ...item, aggregated_output: "<omitted>" }
        : item;
      writeLog(process.stdout, JSON.stringify(fallback), options?.logPrefix);
      if (error instanceof Error) {
        writeLog(
          process.stderr,
          `Failed to serialize Codex item: ${error.message}`,
          options?.logPrefix,
        );
      }
    }
  }
}

function getOrCreateThread(model: string, cwd: string): Thread {
  const key = sessionKey(cwd, model);
  const cached = threadCache.get(key);
  if (cached) {
    return cached;
  }

  const thread = codexClient.startThread({
    model,
    sandboxMode: DEFAULT_SANDBOX,
    workingDirectory: cwd,
  });
  threadCache.set(key, thread);
  return thread;
}

const codexAgent: AgentDefinition = {
  async run(
    model: string,
    prompt: string,
    cwd: string,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    assert(typeof prompt === "string", "Codex agent requires a prompt string.");

    const displayCommand = formatCommand("codex-sdk", [
      "--model",
      model,
      "--sandbox",
      DEFAULT_SANDBOX,
      prompt,
    ]);

    options?.onStart?.(displayCommand);

    const key = sessionKey(model, cwd);
    const thread = getOrCreateThread(model, cwd);

    try {
      const turn = await thread.run(prompt);
      logTurnItems(turn.items, options);
    } catch (error) {
      threadCache.delete(key);
      throw error;
    }

    return { command: displayCommand };
  },
};

export default codexAgent;
