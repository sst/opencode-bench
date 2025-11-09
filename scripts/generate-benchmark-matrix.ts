#!/usr/bin/env bun
import { listAgents } from "~/agents/index.js";
import { dataset } from "~/lib/dataset.js";

const agents = await listAgents();
if (agents.length === 0) {
  process.stderr.write("No agents registered.\n");
  process.exit(1);
}

const include = dataset.flatMap((entry) =>
  agents.flatMap((agent) =>
    agent.models.map((model) => ({
      eval: entry.identifier,
      model,
      agent: agent.name,
    })),
  ),
);

const matrix = JSON.stringify({ include });
process.stdout.write(matrix);
process.exit();
