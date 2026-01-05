import { strict as assert } from "node:assert";
import process from "node:process";

import {
  Codex,
  Usage,
  type SandboxMode,
  type Thread,
  type ThreadItem,
} from "@openai/codex-sdk";

import type { Agent } from "./index.js";

const DEFAULT_SANDBOX: SandboxMode = "workspace-write";

const codexClient = new Codex();
const threadCache = new Map<string, Thread>();

function sessionKey(model: string, cwd: string): string {
  return `${cwd}::${model}`;
}

function logTurnItems(items: ThreadItem[], options: Agent.RunOptions): void {
  for (const item of items) {
    try {
      process.stdout.write(`${options.logger.format(JSON.stringify(item))}\n`);
    } catch (error) {
      const sanitizedItem =
        item.type === "command_execution"
          ? { ...item, aggregated_output: "<omitted>" }
          : item;
      process.stdout.write(
        `${options.logger.format(JSON.stringify(sanitizedItem))}\n`,
      );
      if (error instanceof Error) {
        process.stderr.write(
          `${options.logger.format(
            `Failed to serialize Codex item: ${error.message}`,
          )}\n`,
        );
      }
    }
  }
}

function getOrCreateThread(model: string, cwd: string): Thread {
  const key = sessionKey(model, cwd);
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

const codexAgent: Agent.Definition = {
  async run(model, prompt, options) {
    options.logger.log(
      `codex-sdk --model ${model} --sandbox ${DEFAULT_SANDBOX} ${prompt}`,
    );

    const key = sessionKey(model, options.cwd);
    const thread = getOrCreateThread(model, options.cwd);

    const actions: string[] = [];
    let usage: Usage;
    let cost = 0;
    try {
      const pricingKey = model;
      const pricing = openai.models[pricingKey]?.cost;
      if (!pricing) {
        options.logger.error(
          `No pricing info found for Codex model '${pricingKey}'; reporting $0 cost.`,
        );
      }
      const turn = await thread.run(prompt);
      assert(turn.usage, "The agent did not emit the usage information.");
      usage = turn.usage;
      const billableInput =
        (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0);
      const cachedInput = usage.cached_input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      cost = pricing
        ? (billableInput * pricing.input +
            output * pricing.output +
            cachedInput * pricing.cache_read) /
          1_000_000
        : 0;

      actions.push(...turn.items.map((item) => JSON.stringify(item)));
      logTurnItems(turn.items, options);
    } catch (error) {
      threadCache.delete(key);
      throw error;
    }

    return {
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
  models: Record<
    string,
    {
      cost: {
        input: number;
        output: number;
        cache_read: number;
      };
    }
  >;
};
