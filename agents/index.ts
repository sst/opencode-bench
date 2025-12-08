import { strict as assert } from "node:assert";
import * as opencodeAgent from "~/agents/opencode.js";
import * as codexAgent from "~/agents/codex.js";
import * as claudeCodeAgent from "~/agents/claude-code.js";
import { Logger } from "~/lib/logger.js";

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
      cwd: string,
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
    logger: Logger.Instance;
  }

  export interface Registration<TModel extends string = string> {
    name: string;
    definition: Definition<TModel>;
    models: ReadonlyArray<TModel>;
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
      models?: ReadonlyArray<TModel>;
    },
  ): Registration<TModel> {
    const definition = module.default;
    const models = module.models;

    assert(definition, `Agent module ${name} is missing a default export.`);
    assert(models, `Agent module ${name} is missing the exported models list.`);

    return { name, definition, models };
  }

  export function get(name: string): Registration | undefined {
    return agents[name];
  }

  export function list() {
    return Object.values(agents);
  }
}
