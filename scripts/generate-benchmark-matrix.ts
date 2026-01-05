#!/usr/bin/env bun
import { Agent } from "~/agents/index.js";
import { Task } from "~/src/tasks/index.js";
import { BENCHMARK_MODELS } from "./benchmark-config.js";

const agents = Agent.list();
const tasks = await Task.listNames();
const include = tasks.flatMap((task) =>
  agents.flatMap((agent) => {
    const models = BENCHMARK_MODELS[agent.name] || [];
    return models.map((model) => ({
      eval: task,
      model,
      agent: agent.name,
    }));
  }),
);

const matrix = JSON.stringify({ include });
process.stdout.write(matrix);
process.exit();
