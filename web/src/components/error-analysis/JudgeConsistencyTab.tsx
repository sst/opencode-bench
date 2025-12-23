import { useState } from "react";
import type { EvaluationRunExport, CommitData } from "../../types/benchmark";
import { JudgeComparisonView } from "../JudgeComparisonView";
import { AlertCircle, Filter } from "lucide-react";

interface JudgeConsistencyTabProps {
  runs: EvaluationRunExport[];
  commitData?: CommitData;
}

export function JudgeConsistencyTab({ runs, commitData }: JudgeConsistencyTabProps) {
  const [selectedRun, setSelectedRun] = useState(runs[0] || null);
  const [selectedEpisode, setSelectedEpisode] = useState(0);
  const [varianceFilter, setVarianceFilter] = useState<"all" | "high">("all");

  if (!selectedRun) {
    return <div className="p-4">No runs available</div>;
  }

  const currentEpisode = selectedRun.episodes[selectedEpisode];
  const filteredScores =
    varianceFilter === "high"
      ? currentEpisode.scores.filter((s) => s.variance > 0.15)
      : currentEpisode.scores;

  const highVarianceCount = currentEpisode.scores.filter(
    (s) => s.variance > 0.15
  ).length;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-bold text-gray-900">Filters</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Run Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Run
            </label>
            <select
              value={runs.indexOf(selectedRun)}
              onChange={(e) => setSelectedRun(runs[parseInt(e.target.value)])}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
            >
              {runs.map((run, index) => (
                <option key={index} value={index}>
                  {run.agent} / {run.model.split("/").pop()} /{" "}
                  {run.evaluation.repo.split("/").pop()}
                </option>
              ))}
            </select>
          </div>

          {/* Episode Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Episode
            </label>
            <select
              value={selectedEpisode}
              onChange={(e) => setSelectedEpisode(parseInt(e.target.value))}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
            >
              {selectedRun.episodes.map((_, index) => (
                <option key={index} value={index}>
                  Episode {index} ({(selectedRun.episodes[index].finalScore * 100).toFixed(1)}%)
                </option>
              ))}
            </select>
          </div>

          {/* Variance Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Variance
            </label>
            <select
              value={varianceFilter}
              onChange={(e) => setVarianceFilter(e.target.value as "all" | "high")}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm"
            >
              <option value="all">All Scores ({currentEpisode.scores.length})</option>
              <option value="high">High Variance Only ({highVarianceCount})</option>
            </select>
          </div>
        </div>
      </div>

      {/* High Variance Alert */}
      {highVarianceCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-yellow-900">
              {highVarianceCount} score{highVarianceCount !== 1 ? "s" : ""} with
              high judge disagreement
            </h4>
            <p className="text-sm text-yellow-800 mt-1">
              Judges disagreed significantly (variance &gt; 0.15) on these
              evaluations. Your feedback can help identify systematic issues.
            </p>
          </div>
        </div>
      )}

      {/* Judge Evaluations */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <h3 className="text-2xl font-bold mb-6 text-gray-900">
          Judge Evaluations - Episode {selectedEpisode}
        </h3>
        {filteredScores.length === 0 ? (
          <p className="text-gray-600 text-center py-8">
            No scores match the current filter
          </p>
        ) : (
          <div className="space-y-8">
            {filteredScores.map((scoreResult, index) => (
              <JudgeComparisonView
                key={index}
                score={scoreResult}
                episodeIndex={selectedEpisode}
                evalRepo={selectedRun.evaluation.repo}
                benchmarkCommit={commitData?.commitSha || ""}
                agentModel={`${selectedRun.agent}:${selectedRun.model}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
