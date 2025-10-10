import type { Judge } from "~/lib/judgeTypes.js";
import { getZenLanguageModel } from "~/lib/zenModels.js";

const fallback = (envName: string, defaultValue: string): string =>
  process.env[envName]?.trim() || defaultValue;

export const judges: Judge[] = [
  {
    name: "claude-4.5",
    get model() {
      return getZenLanguageModel(
        fallback("CLAUDE_MODEL", "opencode/claude-sonnet-4-5"),
      );
    },
  },
  {
    name: "gpt-5-codex",
    get model() {
      return getZenLanguageModel(
        fallback("GPT5_CODEX_MODEL", "opencode/gpt-5-codex"),
      );
    },
  },
  {
    name: "kimi",
    get model() {
      return getZenLanguageModel(
        fallback("KIMI_MODEL", "opencode/kimi-k2"),
      );
    },
  },
] as const satisfies Judge[];
