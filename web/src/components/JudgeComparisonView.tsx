import { useState } from "react";
import type { ScoreResultExport } from "../types/benchmark";
import { JudgeFeedbackPanel } from "./feedback/JudgeFeedbackPanel";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

interface JudgeComparisonViewProps {
  score: ScoreResultExport;
  episodeIndex: number;
  evalRepo: string;
  benchmarkCommit: string;
  agentModel: string;
}

export function JudgeComparisonView({
  score,
  episodeIndex,
  evalRepo,
  benchmarkCommit,
  agentModel,
}: JudgeComparisonViewProps) {
  const [expandedJudges, setExpandedJudges] = useState<Set<string>>(new Set());

  const toggleJudge = (judgeName: string) => {
    const newExpanded = new Set(expandedJudges);
    if (newExpanded.has(judgeName)) {
      newExpanded.delete(judgeName);
    } else {
      newExpanded.add(judgeName);
    }
    setExpandedJudges(newExpanded);
  };

  const isHighVariance = score.variance > 0.15;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-bold text-gray-900">
            {score.assignment.name}
          </h4>
          <p className="text-sm text-gray-600">
            Average Score: {(score.averageScore * 100).toFixed(1)}% • Variance:{" "}
            {score.variance.toFixed(3)}
          </p>
        </div>
        {isHighVariance && (
          <div className="flex items-center gap-2 px-3 py-1 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-sm font-medium text-red-700">
              High Variance
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {score.judges.map((judge) => {
          const isExpanded = expandedJudges.has(judge.name);
          const scoreColor = judge.score === 1 ? "text-green-600" : "text-red-600";
          const scoreBg = judge.score === 1 ? "bg-green-50" : "bg-red-50";
          const scoreBorder =
            judge.score === 1 ? "border-green-200" : "border-red-200";

          return (
            <div
              key={judge.name}
              className={`bg-white rounded-lg border-2 ${
                isHighVariance ? "border-red-200" : "border-gray-200"
              } overflow-hidden transition-all`}
            >
              {/* Judge Header */}
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h5 className="font-semibold text-gray-900">{judge.name}</h5>
                    <p className="text-xs text-gray-500">{judge.model}</p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full ${scoreBg} border ${scoreBorder}`}
                  >
                    <span className={`text-sm font-bold ${scoreColor}`}>
                      {judge.score === 1 ? "PASS" : "FAIL"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rationale */}
              <div className="p-4">
                <button
                  onClick={() => toggleJudge(judge.name)}
                  className="w-full flex items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900 mb-2"
                >
                  <span>Rationale</span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>

                {isExpanded ? (
                  <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg text-xs max-h-96 overflow-y-auto">
                    {judge.rationale}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 line-clamp-3">
                    {judge.rationale}
                  </p>
                )}
              </div>

              {/* Feedback Panel */}
              <div className="p-4 pt-0">
                <JudgeFeedbackPanel
                  judgeName={judge.name}
                  judgeModel={judge.model}
                  evalRepo={evalRepo}
                  benchmarkCommit={benchmarkCommit}
                  agentModel={agentModel}
                  episodeIndex={episodeIndex}
                  scoreType={score.assignment.name}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
