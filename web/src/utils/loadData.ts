import type { BenchmarkData, EvaluationRunExport, AnalysisInfo, CommitData } from "../types/benchmark";
import { fetchWorkflowRunsForCommit, fetchArtifactsForRun } from "./github";

export async function loadBenchmarkData(
  commitSha?: string
): Promise<BenchmarkData & { commitData: CommitData }> {
  // If no commit SHA provided, use the hardcoded one for now (we'll fetch latest later)
  const targetCommit = commitSha || "ea446df3c3284cf6be379486a9807d0c48ef7d78";
  
  // Find the "Publish and Benchmark Preview Packages" workflow run for this commit
  const workflowRuns = await fetchWorkflowRunsForCommit(targetCommit);
  const benchmarkRun = workflowRuns.find(
    (run) => run.name.includes("Publish and Benchmark") && run.status === "completed"
  );

  if (!benchmarkRun) {
    console.warn(`No completed benchmark workflow found for commit ${targetCommit}`);
    return {
      runs: [],
      analysis: new Map(),
      commitData: {
        commitSha: targetCommit,
        workflowRun: undefined,
      },
    };
  }

  // Get artifacts for this workflow run
  const artifacts = await fetchArtifactsForRun(benchmarkRun.id);
  const benchmarkArtifacts = artifacts.filter((a) => a.name.startsWith("benchmark-"));
  const analysisArtifacts = artifacts.filter((a) => a.name.startsWith("analysis-"));

  const runs: EvaluationRunExport[] = [];
  
  // Load all benchmark JSON files
  for (const artifact of benchmarkArtifacts) {
    if (artifact.expired) {
      console.warn(`Skipping expired artifact: ${artifact.name}`);
      continue;
    }
    
    try {
      // For now, we'll use the local data. In production, we'd download from GitHub API
      // But since we have the data locally, we'll use the artifact name pattern
      const response = await fetch(`/data/${artifact.name}/benchmark.json`);
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === "object" && "agent" in data) {
          runs.push(data as EvaluationRunExport);
        }
      } else {
        console.warn(`Failed to fetch ${artifact.name}: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Failed to load benchmark from ${artifact.name}:`, error);
    }
  }
  
  console.log(`Loaded ${runs.length} benchmark runs from commit ${targetCommit}`);

  // Load analysis files
  const analysisMap = new Map<string, { text: string; info: AnalysisInfo }>();
  
  for (const artifact of analysisArtifacts) {
    if (artifact.expired) {
      console.warn(`Skipping expired artifact: ${artifact.name}`);
      continue;
    }
    
    try {
      const [textResponse, infoResponse] = await Promise.all([
        fetch(`/data/${artifact.name}/analysis.txt`),
        fetch(`/data/${artifact.name}/analysis-info.json`),
      ]);

      if (textResponse.ok && infoResponse.ok) {
        const text = await textResponse.text();
        const info = await infoResponse.json();
        
        const evalName = artifact.name.replace("analysis-", "");
        analysisMap.set(evalName, {
          text,
          info: info as AnalysisInfo,
        });
      }
    } catch (error) {
      console.error(`Failed to load analysis from ${artifact.name}:`, error);
    }
  }

  return {
    runs,
    analysis: analysisMap,
    commitData: {
      commitSha: targetCommit,
      workflowRun: benchmarkRun ? {
        id: benchmarkRun.id,
        html_url: benchmarkRun.html_url,
        created_at: benchmarkRun.created_at,
      } : undefined,
    },
  };
}

export function getUniqueAgents(runs: EvaluationRunExport[]): string[] {
  return [...new Set(runs.map((r) => r.agent))].sort();
}

export function getUniqueModels(runs: EvaluationRunExport[]): string[] {
  return [...new Set(runs.map((r) => r.model))].sort();
}

export function getUniqueEvaluations(runs: EvaluationRunExport[]): string[] {
  return [...new Set(runs.map((r) => r.evaluation.repo))].sort();
}

export function calculateStats(runs: EvaluationRunExport[]) {
  const totalEpisodes = runs.reduce((sum, r) => sum + r.episodes.length, 0);
  const totalInputTokens = runs.reduce((sum, r) => sum + r.usage.input, 0);
  const totalOutputTokens = runs.reduce((sum, r) => sum + r.usage.output, 0);
  const avgScore = runs.reduce((sum, r) => sum + r.finalScore, 0) / runs.length;
  const avgVariancePenalty = runs.reduce((sum, r) => sum + r.variancePenalty, 0) / runs.length;

  return {
    totalRuns: runs.length,
    totalEpisodes,
    totalInputTokens,
    totalOutputTokens,
    avgScore,
    avgVariancePenalty,
  };
}

export function getTopPerformers(runs: EvaluationRunExport[], limit: number = 5) {
  return [...runs]
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit)
    .map((r) => ({
      agent: r.agent,
      model: r.model,
      evaluation: r.evaluation.repo,
      score: r.finalScore,
      baseScore: r.baseScore,
      variancePenalty: r.variancePenalty,
    }));
}
