import type { DatasetEval, ScoreAssignment } from "~/lib/dataset.js";
import type { Judge } from "~/lib/judgeTypes.js";

export interface ScoreAssignmentExport {
  name: ScoreAssignment["name"];
  weight: ScoreAssignment["weight"];
  args: ScoreAssignment["args"];
}

export interface JudgeResultExport {
  name: Judge["name"];
  model: string;
  score: number;
  rationale: string;
}

export interface ScoreResultExport {
  assignment: ScoreAssignmentExport;
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
  identifier: DatasetEval["identifier"];
  repo: DatasetEval["repo"];
  from: DatasetEval["from"];
  to: DatasetEval["to"];
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
  episodes: Episode[];
  usage: Usage;
  summary: string;
  duration: number;
}
