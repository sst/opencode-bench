import { strict as assert } from "node:assert";

import type { AgentDefinition } from "~/lib/createAgent.js";

export interface AgentRegistration {
  name: string;
  definition: AgentDefinition;
  models: Record<string, string[]>;
}

interface AgentModuleShape {
  default?: AgentDefinition;
  models?: Record<string, string[]>;
}

function createAgentRegistration(
  name: string,
  module: AgentModuleShape,
): AgentRegistration {
  const definition = module.default;
  const models = module.models;

  assert(definition, `Agent module ${name} is missing a default export.`);
  assert(models, `Agent module ${name} is missing the exported models map.`);

  return { name, definition, models };
}

const agents: Record<string, AgentRegistration> = {
  opencode: createAgentRegistration(
    "opencode",
    await import("~/agents/opencode.js"),
  ),
};

export async function getAgent(
  name: string,
): Promise<AgentRegistration | undefined> {
  return agents[name];
}

export async function listAgents(): Promise<AgentRegistration[]> {
  return Object.values(agents);
}
