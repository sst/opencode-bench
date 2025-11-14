import { useState } from "react";
import type { EvaluationRunExport, AnalysisInfo } from "../types/benchmark";
import { ComparisonMatrix } from "./ComparisonMatrix";
import { FileText } from "lucide-react";

interface InsightsViewProps {
  runs: EvaluationRunExport[];
  analysis: Map<string, { text: string; info: AnalysisInfo }>;
}

export function InsightsView({ runs, analysis }: InsightsViewProps) {
  const [selectedAnalysis, setSelectedAnalysis] = useState<string | null>(null);

  const analysisArray = Array.from(analysis.entries());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Insights</h2>
        <p className="text-gray-600 mt-1">
          Cross-agent comparisons and behavioral analysis
        </p>
      </div>

      {/* Comparison Charts */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <h3 className="text-2xl font-bold mb-6 text-gray-900">
          Agent & Model Comparison
        </h3>
        <ComparisonMatrix runs={runs} />
      </div>

      {/* Cross-Agent Analysis Documents */}
      {analysisArray.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <h3 className="text-2xl font-bold mb-6 text-gray-900">
            Cross-Agent Analysis
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            AI-generated analysis comparing all agents on the same evaluation
          </p>

          <div className="space-y-4">
            {analysisArray.map(([evalName, analysisData]) => {
              const isExpanded = selectedAnalysis === evalName;

              return (
                <div
                  key={evalName}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setSelectedAnalysis(isExpanded ? null : evalName)
                    }
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-blue-600" />
                      <div className="text-left">
                        <h4 className="font-semibold text-gray-900">
                          {evalName}
                        </h4>
                        <p className="text-sm text-gray-600">
                          {analysisData.text.split("\n")[0].substring(0, 100)}...
                        </p>
                      </div>
                    </div>
                    <span className="text-sm text-blue-600">
                      {isExpanded ? "Collapse" : "Expand"}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="p-6 bg-gray-50 border-t border-gray-200">
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans">
                        {analysisData.text}
                      </pre>
                      {analysisData.info.url && (
                        <a
                          href={analysisData.info.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                        >
                          View Source →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
