#!/usr/bin/env bun
/**
 * Syncs workflow_dispatch inputs in compare-models.yml with provided agent:model combinations.
 *
 * Usage:
 *   WORKFLOW_MODELS="opencode:opencode/gpt-5-codex,opencode:opencode/claude-sonnet-4-5" bun run scripts/sync-workflow-inputs.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";

interface WorkflowInput {
  description: string;
  type: string;
  default: boolean;
}

interface WorkflowInputs {
  [key: string]: WorkflowInput;
}

// Convert agent:model to workflow input ID
function toInputId(agent: string, model: string): string {
  return `${agent}_${model}`.replace(/\//g, "_").replace(/-/g, "_");
}

// Convert agent:model to display description
function toDescription(agent: string, model: string): string {
  return `${agent}:${model}`;
}

async function main(): Promise<void> {
  const workflowPath = ".github/workflows/compare-models.yml";

  // Models are passed via WORKFLOW_MODELS environment variable (comma-separated agent:model pairs)
  const modelsEnv = process.env.WORKFLOW_MODELS;
  if (!modelsEnv) {
    console.error(
      "Error: WORKFLOW_MODELS environment variable is required (comma-separated agent:model pairs)",
    );
    process.exit(1);
  }

  const combinations = modelsEnv.split(",").map((pair) => {
    const [agent, model] = pair.split(":");
    if (!agent || !model) {
      console.error(`Invalid agent:model pair: ${pair}`);
      process.exit(1);
    }
    return { agent, model };
  });

  // Load the workflow file
  const workflowContent = readFileSync(workflowPath, "utf8");
  const workflow = YAML.parse(workflowContent);

  // Build new inputs
  const inputs: WorkflowInputs = {};

  for (const { agent, model } of combinations) {
    const inputId = toInputId(agent, model);
    inputs[inputId] = {
      description: toDescription(agent, model),
      type: "boolean",
      default: false,
    };
  }

  // Update the workflow
  workflow.on.workflow_dispatch.inputs = inputs;

  // Convert back to YAML with proper formatting
  const yamlOutput = YAML.stringify(workflow, {
    indent: 2,
    lineWidth: 0,
  });

  // Write back to file
  writeFileSync(workflowPath, yamlOutput, "utf8");

  console.log(
    `✓ Updated ${workflowPath} with ${combinations.length} agent:model combinations:`,
  );
  for (const { agent, model } of combinations) {
    console.log(`  - ${agent}:${model} (ID: ${toInputId(agent, model)})`);
  }

  console.log(
    "\n✓ The build-workflow-matrix.ts script will automatically recognize these combinations.",
  );
  console.log(
    "  No manual updates needed - everything is dynamically generated!",
  );
}

await main();
