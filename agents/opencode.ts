import { createAgent } from "~/lib/createAgent.js";

export const models: string[] = [
  // "opencode/gpt-5",
  "opencode/gpt-5-codex",
  "opencode/claude-sonnet-4-5",
  // "opencode/claude-sonnet-4",
  // "opencode/claude-3-5-haiku",
  // "opencode/claude-opus-4-1",
  // "opencode/qwen3-coder",
  // "opencode/grok-code",
  // "opencode/kimi-k2",
];

// TODO: opencode command to generate a session so the agent runs for each task would share the same context. right now there's no way to generate one but rather only exporting is possible.
export default createAgent((model, prompt) => {
  return {
    command: "opencode",
    args: ["run", "-m", model, prompt],
  };
});
