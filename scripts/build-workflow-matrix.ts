#!/usr/bin/env bun
/**
 * Builds a GitHub Actions matrix from workflow_dispatch boolean inputs.
 *
 * Usage:
 *   bun run scripts/build-workflow-matrix.ts
 *
 * Reads JSON from stdin with format:
 *   {
 *     "opencode_opencode_gpt_5_codex": "true",
 *     "opencode_opencode_claude_sonnet_4_5": "false",
 *     ...
 *   }
 *
 * Outputs matrix JSON to stdout with all evals from dataset.yaml.
 */

import { readFileSync } from "node:fs";
import YAML from "yaml";

interface WorkflowInputs {
  [key: string]: string | boolean;
}

interface MatrixEntry {
  agent: string;
  model: string;
  eval: string;
}

interface DatasetEntry {
  repo: string;
}

// Mapping from input ID pattern to agent:model
const INPUT_MAPPINGS = [
  // OpenCode agent
  { pattern: /^opencode_opencode_gpt_5_codex$/, agent: "opencode", model: "opencode/gpt-5-codex" },
  { pattern: /^opencode_opencode_claude_sonnet_4_5$/, agent: "opencode", model: "opencode/claude-sonnet-4-5" },
  // Codex agent
  { pattern: /^codex_gpt_5_codex$/, agent: "codex", model: "gpt-5-codex" },
  { pattern: /^codex_gpt_5$/, agent: "codex", model: "gpt-5" },
  // Claude Code agent
  { pattern: /^claude_code_claude_sonnet_4_5$/, agent: "claude-code", model: "claude-sonnet-4-5" },
];

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

async function main(): Promise<void> {
  // Read inputs from stdin
  const stdinText = await Bun.stdin.text();
  const inputs: WorkflowInputs = JSON.parse(stdinText);

  // Load all evals from dataset
  const dataset = loadDataset();

  // Collect selected agent:model combinations
  const selectedCombinations: Array<{ agent: string; model: string }> = [];

  for (const [key, value] of Object.entries(inputs)) {
    // Check if input is true (handle both string "true" and boolean true)
    if (value !== "true" && value !== true) {
      continue;
    }

    // Find matching agent:model combination
    const mapping = INPUT_MAPPINGS.find((m) => m.pattern.test(key));
    if (mapping) {
      selectedCombinations.push({
        agent: mapping.agent,
        model: mapping.model,
      });
    }
  }

  if (selectedCombinations.length === 0) {
    process.stderr.write("Error: At least one model must be selected\n");
    process.exit(1);
  }

  // Build matrix: cross product of selected combinations × all evals
  const include: MatrixEntry[] = dataset.flatMap((entry) =>
    selectedCombinations.map((combo) => ({
      agent: combo.agent,
      model: combo.model,
      eval: entry.repo,
    })),
  );

  const matrix = { include };
  process.stdout.write(JSON.stringify(matrix));
  process.exit(0);
}

await main();
