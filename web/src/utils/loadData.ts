import type { BenchmarkData, EvaluationRunExport, AnalysisInfo, CommitData } from "../types/benchmark";

export async function loadBenchmarkData(
  commitSha?: string
): Promise<BenchmarkData & { commitData: CommitData }> {
  const targetCommit = commitSha || "ea446df3c3284cf6be379486a9807d0c48ef7d78";

  const runs: EvaluationRunExport[] = [];

  // Load metadata to get artifact list
  try {
    const metadataResponse = await fetch('/data/metadata.json');
    if (!metadataResponse.ok) {
      console.error('Failed to load metadata.json');
      return {
        runs: [],
        analysis: new Map(),
        commitData: { commitSha: targetCommit },
      };
    }

    const metadata = await metadataResponse.json();
    const benchmarkArtifacts = metadata.artifacts.filter((a: any) => a.name.startsWith("benchmark-"));
    const analysisArtifacts = metadata.artifacts.filter((a: any) => a.name.startsWith("analysis-"));

    // Load all benchmark JSON files
    for (const artifact of benchmarkArtifacts) {
      if (artifact.expired) {
        console.warn(`Skipping expired artifact: ${artifact.name}`);
        continue;
      }

      try {
        const response = await fetch(`/data/${artifact.name}/benchmark.json`);
        if (response.ok) {
          const data = await response.json();
          if (data && typeof data === "object" && "agent" in data) {
            runs.push(data as EvaluationRunExport);
          }
        }
      } catch (error) {
        console.error(`Failed to load benchmark from ${artifact.name}:`, error);
      }
    }

    console.log(`Loaded ${runs.length} benchmark runs`);

    // Load analysis files
    const analysisMap = new Map<string, { text: string; info: AnalysisInfo }>();

    for (const artifact of analysisArtifacts) {
      if (artifact.expired) continue;

      try {
        const [textResponse, infoResponse] = await Promise.all([
          fetch(`/data/${artifact.name}/analysis.txt`),
          fetch(`/data/${artifact.name}/analysis-info.json`),
        ]);

        if (textResponse.ok && infoResponse.ok) {
          const text = await textResponse.text();
          const info = await infoResponse.json();
          const evalName = artifact.name.replace("analysis-", "");
          analysisMap.set(evalName, { text, info: info as AnalysisInfo });
        }
      } catch (error) {
        console.error(`Failed to load analysis from ${artifact.name}:`, error);
      }
    }

    return {
      runs,
      analysis: analysisMap,
      commitData: {
        commitSha: metadata.commit,
        workflowRun: metadata.workflowRun ? {
          id: metadata.workflowRun.id,
          html_url: `https://github.com/sst/opencode-bench/actions/runs/${metadata.workflowRun.id}`,
          created_at: metadata.workflowRun.createdAt,
        } : undefined,
      },
    };
  } catch (error) {
    console.error('Failed to load benchmark data:', error);
    return {
      runs: [],
      analysis: new Map(),
      commitData: { commitSha: targetCommit },
    };
  }
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
