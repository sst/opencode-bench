import type { Judge } from "~/lib/judgeTypes.js";
import { getZenLanguageModel } from "~/lib/zenModels.js";

function resolveJudgeModelId(judgeName: Judge["name"]): string {
  switch (judgeName) {
    case "claude-4.5":
      return "opencode/claude-sonnet-4-5";
    case "gpt-5-codex":
      return "opencode/gpt-5-codex";
    case "kimi":
      return "opencode/kimi-k2";
    default:
      return judgeName;
  }
}

export function getJudgeModelId(judgeName: Judge["name"]): string {
  return resolveJudgeModelId(judgeName);
}

export const judges: Judge[] = [
  {
    name: "claude-4.5",
    get model() {
      return getZenLanguageModel(resolveJudgeModelId("claude-4.5"));
    },
  },
  {
    name: "gpt-5-codex",
    get model() {
      return getZenLanguageModel(resolveJudgeModelId("gpt-5-codex"));
    },
  },
  {
    name: "kimi",
    get model() {
      return getZenLanguageModel(resolveJudgeModelId("kimi"));
    },
  },
] as const satisfies Judge[];
