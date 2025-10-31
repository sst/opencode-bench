export type AgentPrompt = string;

export type AgentCommandSpec =
  | string
  | {
      command: string;
      args?: string[];
      shell?: boolean;
    };

export type AgentExecutor = (
  model: string,
  prompt: AgentPrompt,
) => AgentCommandSpec | Promise<AgentCommandSpec>;

export interface AgentDefinition {
  run: (
    model: string,
    prompt: AgentPrompt,
    cwd: string,
    options?: AgentRunOptions,
  ) => Promise<AgentRunResult>;
}

export interface AgentRunResult {
  command: string;
  actions: string[];
  usage: {
    input: number;
    output: number;
  };
}

export interface AgentRunOptions {
  onStart?: (command: string) => void;
  logPrefix?: string;
}
