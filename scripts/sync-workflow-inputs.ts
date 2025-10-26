#!/usr/bin/env bun
/**
 * Syncs workflow_dispatch inputs in compare-models.yml with available agent:model combinations.
 * Run this after modifying agent model lists to keep the workflow in sync.
 *
 * Usage:
 *   bun run scripts/sync-workflow-inputs.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { listAgents } from "~/agents/index.js";
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
  return `${agent}_${model}`
    .replace(/\//g, "_")
    .replace(/-/g, "_");
}

// Convert agent:model to display description
function toDescription(agent: string, model: string): string {
  return `${agent}:${model}`;
}

async function main(): Promise<void> {
  const workflowPath = ".github/workflows/compare-models.yml";

  // Load the workflow file
  const workflowContent = readFileSync(workflowPath, "utf8");
  const workflow = YAML.parse(workflowContent);

  // Get all available agent:model combinations
  const agents = await listAgents();
  const combinations: Array<{ agent: string; model: string }> = [];

  for (const agent of agents) {
    for (const model of agent.models) {
      combinations.push({ agent: agent.name, model });
    }
  }

  if (combinations.length === 0) {
    console.error("No agent:model combinations found");
    process.exit(1);
  }

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

  console.log(`✓ Updated ${workflowPath} with ${combinations.length} agent:model combinations:`);
  for (const { agent, model } of combinations) {
    console.log(`  - ${agent}:${model} (ID: ${toInputId(agent, model)})`);
  }

  console.log("\n✓ The build-workflow-matrix.ts script will automatically recognize these combinations.");
  console.log("  No manual updates needed - everything is dynamically generated!");
}

await main();
