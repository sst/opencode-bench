import { createAgent } from "~/lib/createAgent.js";

export const models: Record<string, string[]> = {
  opencode: [
    "gpt-5",
    "gpt-5-codex",
    "claude-sonnet-4-5",
    "claude-sonnet-4",
    "claude-3-5-haiku",
    "claude-opus-4-1",
    "qwen3-coder",
    "grok-code",
    "kimi-k2",
  ],
};

// TODO: opencode command to generate a session so the agent runs for each task would share the same context. right now there's no way to generate one but rather only exporting is possible.
export default createAgent((provider, model, prompt) => {
  const modelHandle = `${provider}/${model}`;

  return {
    command: "opencode",
    args: ["run", "-m", modelHandle, prompt],
  };
});
