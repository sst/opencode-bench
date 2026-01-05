#!/usr/bin/env bun
import { Task } from "~/src/tasks/index.js";

// Models are passed via BENCHMARK_MODELS environment variable (comma-separated agent:model pairs)
// Example: BENCHMARK_MODELS="opencode:opencode/gpt-5-codex,opencode:opencode/claude-sonnet-4-5"
const modelsEnv = process.env.BENCHMARK_MODELS;
if (!modelsEnv) {
  console.error(
    "Error: BENCHMARK_MODELS environment variable is required (comma-separated agent:model pairs)",
  );
  process.exit(1);
}

const agentModelPairs = modelsEnv.split(",").map((pair) => {
  const [agent, model] = pair.split(":");
  if (!agent || !model) {
    console.error(`Invalid agent:model pair: ${pair}`);
    process.exit(1);
  }
  return { agent, model };
});

const tasks = await Task.listNames();
const include = tasks.flatMap((task) =>
  agentModelPairs.map(({ agent, model }) => ({
    eval: task,
    model,
    agent,
  })),
);

const matrix = JSON.stringify({ include });
process.stdout.write(matrix);
process.exit();
