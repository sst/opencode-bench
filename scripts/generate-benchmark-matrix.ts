#!/usr/bin/env bun
import { readFileSync } from "node:fs";

import YAML from "yaml";

import { listAgents } from "~/agents/index.js";

interface DatasetEntry {
  repo: string;
}

function loadDataset(): DatasetEntry[] {
  const raw = readFileSync(new URL("../dataset.yaml", import.meta.url), "utf8");
  const parsed = YAML.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("dataset.yaml must contain an array.");
  }

  return parsed
    .map((entry) => entry?.repo)
    .filter(
      (repo): repo is string => typeof repo === "string" && repo.length > 0,
    )
    .map((repo) => ({ repo }));
}

const dataset = loadDataset();
const agents = await listAgents();
if (agents.length === 0) {
  process.stderr.write("No agents registered.\n");
  process.exit(1);
}

const include = dataset.flatMap((entry) =>
  agents.flatMap((agent) =>
    agent.models.map((model) => ({
      eval: entry.repo,
      model,
      agent: agent.name,
    })),
  ),
);

const matrix = JSON.stringify({ include });
process.stdout.write(matrix);
process.exit();
