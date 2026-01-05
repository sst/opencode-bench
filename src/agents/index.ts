import { strict as assert } from "node:assert";
import * as opencodeAgent from "./opencode.js";
import * as codexAgent from "./codex.js";
import * as claudeCodeAgent from "./claude-code.js";
import { Logger } from "../util/logger.js";

export namespace Agent {
  export type Prompt = string;

  export type CommandSpec =
    | string
    | {
        command: string;
        args?: string[];
        shell?: boolean;
      };

  export type Executor = (
    model: string,
    prompt: Prompt,
  ) => CommandSpec | Promise<CommandSpec>;

  export interface Definition<TModel extends string = string> {
    run: (
      model: TModel,
      prompt: Prompt,
      options: RunOptions,
    ) => Promise<RunResult>;
    cleanup?: () => void | Promise<void>;
  }

  export interface RunResult {
    actions: string[];
    usage: {
      input: number;
      output: number;
      cost: number;
    };
  }

  export interface RunOptions {
    cwd: string;
    logger: Logger.Instance;
  }

  export interface Registration<TModel extends string = string> {
    name: string;
    definition: Definition<TModel>;
  }

  const agents: Record<string, Registration<any>> = {
    // Only keep opencode active while debugging timeouts for specific models.
    opencode: createRegistration("opencode", opencodeAgent),
    //codex: createRegistration("codex", codexAgent),
    //"claude-code": createRegistration("claude-code", claudeCodeAgent),
  };

  function createRegistration<TModel extends string>(
    name: string,
    module: {
      default?: Definition<TModel>;
    },
  ): Registration<TModel> {
    const definition = module.default;

    assert(definition, `Agent module ${name} is missing a default export.`);

    return { name, definition };
  }

  export function get(name: string): Registration {
    const agent = agents[name];
    if (!agent) throw new Error(`Agent ${name} was not found.`);
    return agent;
  }

  export function list() {
    return Object.values(agents);
  }
}
