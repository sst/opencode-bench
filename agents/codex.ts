import { strict as assert } from "node:assert";
import process from "node:process";

import {
  Codex,
  Usage,
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

export const models = [
  "gpt-5-codex",
  "gpt-5.1-codex",
  // "gpt-5",
  // "o3",
  // "o4-mini"
] as const;

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
      const sanitizedItem = isCommandExecutionItem(item)
        ? { ...item, aggregated_output: "<omitted>" }
        : item;
      writeLog(
        process.stdout,
        JSON.stringify(sanitizedItem),
        options?.logPrefix,
      );
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

const codexAgent: AgentDefinition<(typeof models)[number]> = {
  async run(
    model: (typeof models)[number],
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

    const actions: string[] = [];
    let usage: Usage;
    let cost = 0;
    try {
      const pricingKey = model;
      const pricing = openai.models[pricingKey]?.cost;
      const turn = await thread.run(prompt);
      assert(turn.usage, "The agent did not emit the usage information.");
      usage = turn.usage;
      if (!pricing) {
        if (!missingPricing.has(pricingKey)) {
          missingPricing.add(pricingKey);
          console.warn(
            `[codex] Pricing not found for ${pricingKey}; using $0 for cost calculation.`,
          );
        }
      } else {
        const billableInput =
          (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0);
        const cachedInput = usage.cached_input_tokens ?? 0;
        const output = usage.output_tokens ?? 0;
        cost =
          (billableInput * pricing.input +
            output * pricing.output +
            cachedInput * pricing.cache_read) /
          1_000_000;
      }

      actions.push(...turn.items.map((item) => JSON.stringify(item)));
      logTurnItems(turn.items, options);
    } catch (error) {
      threadCache.delete(key);
      throw error;
    }

    return {
      command: displayCommand,
      actions,
      usage: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cost,
      },
    };
  },
};

export default codexAgent;


const response = await fetch("https://models.dev/api.json");
if (!response.ok) {
  throw new Error(`models.dev responded with ${response.status}`);
}

const openai = (await response.json())["openai"] as {
  models: Record<string, {
    cost: {
      input: number,
      output: number,
      cache_read: number
    }
  }>
}

const missingPricing = new Set<string>();
