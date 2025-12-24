#!/usr/bin/env bun
/**
 * Triggers the run-benchmark workflow.
 *
 * Usage:
 *   bun run scripts/run-benchmark.ts --run 5 --model gpt-4
 *   bun run scripts/run-benchmark.ts --model claude-3
 *   bun run scripts/run-benchmark.ts
 */

import { $ } from "bun";
import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    run: { type: "string", default: "1" },
    model: { type: "string" },
  },
});

if (!values.model) {
  console.error("Error: --model is required");
  process.exit(1);
}

await $`gh workflow run run-benchmark.yml --field run=${values.run} --field model=${values.model}`;

console.log(
  `Workflow dispatched successfully (run: ${values.run}, model: ${values.model})`,
);
