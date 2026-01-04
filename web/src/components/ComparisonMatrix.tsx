import { useMemo, useState } from "react";
import type { EvaluationRunExport } from "../types/benchmark";
import { getUniqueAgents, getUniqueModels, getUniqueEvaluations } from "../utils/loadData";

interface ComparisonMatrixProps {
  runs: EvaluationRunExport[];
}

export function ComparisonMatrix({ runs }: ComparisonMatrixProps) {
  const agents = useMemo(() => getUniqueAgents(runs), [runs]);
  const models = useMemo(() => getUniqueModels(runs), [runs]);
  const evaluations = useMemo(() => getUniqueEvaluations(runs), [runs]);

  // Create a map for quick lookup: agent+model+evaluation -> score
  const scoreMap = useMemo(() => {
    const map = new Map<string, EvaluationRunExport>();
    for (const run of runs) {
      const key = `${run.agent}|${run.model}|${run.evaluation.repo}`;
      map.set(key, run);
    }
    return map;
  }, [runs]);

  const formatScore = (score: number) => (score * 100).toFixed(1);

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return "bg-gradient-to-br from-green-500 to-emerald-600";
    if (score >= 0.6) return "bg-gradient-to-br from-green-400 to-green-500";
    if (score >= 0.4) return "bg-gradient-to-br from-yellow-400 to-orange-400";
    if (score >= 0.2) return "bg-gradient-to-br from-orange-400 to-orange-500";
    return "bg-gradient-to-br from-red-400 to-red-500";
  };

  // Group by evaluation for tabs
  const [selectedEval, setSelectedEval] = useState<string>(
    evaluations[0] || ""
  );

  return (
    <div className="comparison-matrix">
      <div className="mb-8">
        <h2 className="text-4xl font-bold mb-2 bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
          Comparison Matrix
        </h2>
        <p className="text-gray-600">Side-by-side comparison of agents and models</p>
      </div>

      {/* Evaluation Selector */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Select Evaluation:
        </label>
        <select
          value={selectedEval}
          onChange={(e) => setSelectedEval(e.target.value)}
          className="w-full max-w-md px-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all font-medium"
        >
          {evaluations.map((evalName) => (
            <option key={evalName} value={evalName}>
              {evalName}
            </option>
          ))}
        </select>
      </div>

      {/* Matrix Table */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left p-2 border-b">Agent</th>
              {models.map((model) => (
                <th key={model} className="text-center p-2 border-b text-sm">
                  {model.split("/").pop()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent} className="border-b">
                <td className="p-2 font-medium">
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                    {agent}
                  </span>
                </td>
                {models.map((model) => {
                  const key = `${agent}|${model}|${selectedEval}`;
                  const run = scoreMap.get(key);
                  const score = run?.finalScore ?? null;

                  return (
                    <td key={model} className="p-2 text-center">
                      {score !== null ? (
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-16 h-8 rounded ${getScoreColor(
                              score
                            )} flex items-center justify-center text-white text-sm font-semibold`}
                            title={`Score: ${formatScore(score)}%`}
                          >
                            {formatScore(score)}%
                          </div>
                          {run && (
                            <a
                              href={run.jobUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline mt-1"
                            >
                              View Job
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
