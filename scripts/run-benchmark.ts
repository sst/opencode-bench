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
    agent: { type: "string" },
    model: { type: "string" },
  },
});

if (!values.model) {
  console.error("Error: --model is required");
  process.exit(1);
}

const tasks = await Task.listNames();

// Get the current latest run ID before dispatching
let previousRunId: number | null = null;
try {
  const result =
    await $`gh run list --workflow=run-benchmark.yml --limit=1 --json databaseId`.text();
  const runs = JSON.parse(result);
  if (runs.length > 0) {
    previousRunId = runs[0].databaseId;
  }
} catch (error) {
  console.error("Warning: Failed to fetch previous run ID:", error);
}

await $`gh workflow run run-benchmark.yml --field agent=${
  values.agent
} --field model=${values.model} --field tasks=${tasks.join(",")}`;

console.log(`Workflow dispatched successfully`);
console.log(`Agent: ${values.agent}`);
console.log(`Model: ${values.model}`);
console.log(`Tasks:`);
tasks.forEach((task) => {
  console.log(`  - ${task}`);
});

// Wait for the new workflow run to be created and get its URL
console.log("\nWaiting for workflow run to be created...");
let workflowUrl: string | null = null;
for (let i = 0; i < 10; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const result =
      await $`gh run list --workflow=run-benchmark.yml --limit=5 --json databaseId,url,status`.text();
    const runs = JSON.parse(result);
    // Find the new run (one that wasn't there before)
    const newRun = runs.find(
      (run: { databaseId: number; status: string }) =>
        run.databaseId !== previousRunId &&
        (run.status === "queued" || run.status === "in_progress"),
    );
    if (newRun) {
      workflowUrl = newRun.url;
      break;
    }
  } catch (error) {
    // Continue waiting
  }
}

if (workflowUrl) {
  console.log(`Workflow URL: ${workflowUrl}`);
} else {
  console.log(
    "Could not retrieve workflow URL. Check: gh run list --workflow=run-benchmark.yml",
  );
}

process.exit();
