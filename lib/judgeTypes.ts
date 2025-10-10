import type { generateObject } from "ai";

type GenerateObjectOptions = Parameters<typeof generateObject>[0];

export type JudgeModel = GenerateObjectOptions["model"];

export type JudgeName = "claude-4.5" | "gpt-5-codex" | "kimi";

export interface Judge {
  name: JudgeName;
  model: JudgeModel;
}
