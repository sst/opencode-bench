export interface Usage {
  input: number;
  output: number;
}

export interface EvaluationMetadataExport {
  repo: string;
  from: string;
  to: string;
}

export interface JudgeResultExport {
  name: string;
  model: string;
  score: number;
  rationale: string;
}

export interface ScoreAssignmentExport {
  name: string;
  weight: number;
  args?: Record<string, unknown>;
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
}

export interface AnalysisInfo {
  eval: string;
  safe: string;
  url: string;
}

export interface CommitData {
  commitSha: string;
  commitMessage?: string;
  commitDate?: string;
  workflowRun?: {
    id: number;
    html_url: string;
    created_at: string;
  };
}

export interface ErrorAnalysisFeedback {
  feedbackId: string;
  timestamp: string;
  userId?: string;
  componentType: "planner" | "judge" | "agent-summary" | "cross-analysis";
  componentId: string;
  rating?: string;
  category?: string;
  comment?: string;
  evalRepo: string;
  benchmarkCommit: string;
  agentModel?: string;
}

export interface BenchmarkData {
  runs: EvaluationRunExport[];
  analysis: Map<string, { text: string; info: AnalysisInfo }>;
  commitData?: CommitData;
}
