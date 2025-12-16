#!/usr/bin/env bun
import { Agent } from "~/agents/index.js";
import { Eval } from "~/evals/index.js";

const agents = Agent.list();
if (agents.length === 0) {
  process.stderr.write("No agents registered.\n");
  process.exit(1);
}

const evals = await Eval.load();
const include = evals.flatMap((ev) =>
  agents.flatMap((agent) =>
    agent.models.map((model) => ({
      eval: ev.id,
      model,
      agent: agent.name,
    })),
  ),
);

const matrix = JSON.stringify({ include });
process.stdout.write(matrix);
process.exit();
