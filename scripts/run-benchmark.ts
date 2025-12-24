#!/usr/bin/env bun
/**
 * Triggers the run-benchmark workflow.
 *
 * Usage:
 *   bun run scripts/run-benchmark.ts --model gpt-4
 *   bun run scripts/run-benchmark.ts --run 5 --model gpt-4
 */

import { $ } from "bun";
import { parseArgs } from "util";
import { Task } from "~/src/tasks/index.js";

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

const tasks = await Task.listNames();

await $`gh workflow run run-benchmark.yml --field run=${
  values.run
} --field model=${values.model} --field tasks=${tasks.join(",")}`;

console.log(`Workflow dispatched successfully`);
console.log(`Run count: ${values.run}`);
console.log(`Model: ${values.model}`);
console.log(`Tasks:`);
tasks.forEach((task) => {
  console.log(`  - ${task}`);
});
process.exit();
