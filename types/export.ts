import type { Eval } from "~/evals/index.js";
import type { Judge } from "~/lib/judgeTypes.js";

export interface JudgeResultExport {
  name: Judge["name"];
  model: string;
  score: number;
  rationale: string;
}

export interface ScoreResultExport {
  assignment: Eval.Instance["scores"][number];
  averageScore: number;
  normalizedWeight: number;
  variance: number;
  judges: JudgeResultExport[];
}

export interface Episode {
  finalScore: number;
  baseScore: number;
  variancePenalty: number;
  scores: ScoreResultExport[];
  usage: Usage;
}

export interface EvaluationMetadataExport {
  identifier: Eval.Instance["id"];
  repo: Eval.Instance["repo"];
  from: Eval.Instance["from"];
  to: Eval.Instance["to"];
}

export interface Usage {
  input: number;
  output: number;
  cost: number;
}

export interface EvaluationRunExport {
  agent: string;
  evaluation: EvaluationMetadataExport;
  model: string;
  jobUrl: string;
  finalScore: number;
  baseScore: number;
  variancePenalty: number;
  scores: ScoreResultExport[];
  usage: Usage;
  summary: string;
  duration: number;
}
