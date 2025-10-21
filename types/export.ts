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

export interface EvaluationMetadataExport {
  repo: DatasetEval["repo"];
  from: DatasetEval["from"];
  to: DatasetEval["to"];
}

export interface EvaluationRunExport {
  agent: string;
  evaluation: EvaluationMetadataExport;
  model: string;
  summary: {
    finalScore: number;
    baseScore: number;
    variancePenalty: number;
  };
  scores: ScoreResultExport[];
}
