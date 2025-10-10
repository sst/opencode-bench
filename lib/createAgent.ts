import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";

export type AgentPrompt = string;

export type AgentCommandSpec =
  | string
  | {
      command: string;
      args?: string[];
      shell?: boolean;
    };

export type AgentExecutor = (
  provider: string,
  model: string,
  prompt: AgentPrompt
) => AgentCommandSpec | Promise<AgentCommandSpec>;

export interface AgentDefinition {
  run: (
    provider: string,
    model: string,
    prompt: AgentPrompt,
    cwd?: string,
    options?: AgentRunOptions
  ) => Promise<AgentRunResult>;
}

export interface AgentRunResult {
  command: string;
}

export interface AgentRunOptions {
  onStart?: (command: string) => void;
}

export function createAgent(executor: AgentExecutor): AgentDefinition {
  return {
    async run(provider, model, prompt, cwd, options) {
      const spec = await executor(provider, model, prompt);
      const normalized = normalizeCommandSpec(spec);

      options?.onStart?.(normalized.display);

      await runCommand(normalized, prompt, cwd);

      return { command: normalized.display };
    }
  };
}

interface NormalizedCommand {
  command: string;
  args: string[];
  shell: boolean;
  display: string;
}

function normalizeCommandSpec(spec: AgentCommandSpec): NormalizedCommand {
  if (typeof spec === "string") {
    assert(spec.length > 0, "Agents must return a non-empty command.");
    return {
      command: spec,
      args: [],
      shell: true,
      display: spec
    };
  }

  assert(spec.command.length > 0, "Agents must provide a command to run.");

  const args = spec.args ?? [];
  args.forEach((arg, index) => {
    assert(
      typeof arg === "string",
      `Agent argument at position ${index} must be a string.`
    );
  });

  const shell = spec.shell ?? false;
  const display = formatForDisplay(spec.command, args);

  return {
    command: spec.command,
    args,
    shell,
    display
  };
}

function formatForDisplay(command: string, args: string[]): string {
  if (args.length === 0) {
    return command;
  }

  const renderedArgs = args.map((arg) =>
    /[\s"']/.test(arg) ? JSON.stringify(arg) : arg
  );

  return `${command} ${renderedArgs.join(" ")}`;
}

async function runCommand(
  command: NormalizedCommand,
  prompt: AgentPrompt,
  cwd?: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd,
      shell: command.shell,
      stdio: ["pipe", "inherit", "inherit"]
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const message =
          code !== null
            ? `Agent command exited with code ${code}`
            : `Agent command terminated by signal ${signal}`;
        reject(new Error(message));
      }
    });

    if (child.stdin) {
      child.stdin.write(prompt, (error) => {
        if (error) {
          console.error("Failed to write prompt to agent stdin:", error);
        }
        child.stdin?.end();
      });
    }
  });
}
