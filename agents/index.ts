import { strict as assert } from "node:assert";

import type { AgentDefinition } from "~/lib/createAgent.js";

export interface AgentRegistration<TModel extends string = string> {
  name: string;
  definition: AgentDefinition<TModel>;
  models: ReadonlyArray<TModel>;
}

interface AgentModuleShape<TModel extends string = string> {
  default?: AgentDefinition<TModel>;
  models?: ReadonlyArray<TModel>;
}

function createAgentRegistration<TModel extends string>(
  name: string,
  module: AgentModuleShape<TModel>,
): AgentRegistration<TModel> {
  const definition = module.default;
  const models = module.models;

  assert(definition, `Agent module ${name} is missing a default export.`);
  assert(models, `Agent module ${name} is missing the exported models list.`);

  return { name, definition, models };
}

const agents: Record<string, AgentRegistration<any>> = {
  // Only keep opencode active while debugging timeouts for specific models.
  opencode: createAgentRegistration(
    "opencode",
    await import("~/agents/opencode.js"),
  ),
  // codex: createAgentRegistration("codex", await import("~/agents/codex.js")),
  // "claude-code": createAgentRegistration(
  //   "claude-code",
  //   await import("~/agents/claude-code.js"),
  // ),
};

export async function getAgent(
  name: string,
): Promise<AgentRegistration | undefined> {
  return agents[name];
}

export function listAgents() {
  return Object.values(agents);
}
