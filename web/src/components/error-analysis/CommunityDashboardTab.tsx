import { useState, useEffect } from "react";
import type { EvaluationRunExport, ErrorAnalysisFeedback } from "../../types/benchmark";
import { getAllFeedback, exportFeedbackAsJSON, clearAllFeedback } from "../../utils/feedback";
import { Download, Trash2, ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";

interface CommunityDashboardTabProps {
  runs: EvaluationRunExport[];
}

export function CommunityDashboardTab({}: CommunityDashboardTabProps) {
  const [feedback, setFeedback] = useState<ErrorAnalysisFeedback[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setFeedback(getAllFeedback());
  }, [refreshKey]);

  const handleExport = () => {
    const jsonString = exportFeedbackAsJSON();
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opencode-feedback-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (confirm("Are you sure you want to clear all feedback? This cannot be undone.")) {
      clearAllFeedback();
      setRefreshKey((k) => k + 1);
    }
  };

  const judgeFeedback = feedback.filter((f) => f.componentType === "judge");
  const agreeFeedback = judgeFeedback.filter((f) => f.rating === "agree");
  const disagreeFeedback = judgeFeedback.filter((f) => f.rating === "disagree");

  const feedbackByJudge: Record<string, number> = {};
  judgeFeedback.forEach((f) => {
    const judgeName = f.componentId.split(":")[1];
    feedbackByJudge[judgeName] = (feedbackByJudge[judgeName] || 0) + 1;
  });

  const feedbackByScoreType: Record<string, number> = {};
  judgeFeedback.forEach((f) => {
    const scoreType = f.componentId.split(":")[0];
    feedbackByScoreType[scoreType] = (feedbackByScoreType[scoreType] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Feedback</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{feedback.length}</p>
            </div>
            <MessageSquare className="w-10 h-10 text-blue-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Judge Agreements</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{agreeFeedback.length}</p>
            </div>
            <ThumbsUp className="w-10 h-10 text-green-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Judge Disagreements</p>
              <p className="text-3xl font-bold text-red-600 mt-1">{disagreeFeedback.length}</p>
            </div>
            <ThumbsDown className="w-10 h-10 text-red-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Agreement Rate</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">
                {judgeFeedback.length > 0
                  ? `${((agreeFeedback.length / judgeFeedback.length) * 100).toFixed(0)}%`
                  : "N/A"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Actions</h3>
        <div className="flex gap-3">
          <button
            onClick={handleExport}
            disabled={feedback.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Feedback (JSON)
          </button>
          <button
            onClick={handleClear}
            disabled={feedback.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Feedback
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Export your feedback and submit it via GitHub issues to help improve the benchmark.
        </p>
      </div>

      {/* Feedback by Judge */}
      {Object.keys(feedbackByJudge).length > 0 && (
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Feedback by Judge</h3>
          <div className="space-y-3">
            {Object.entries(feedbackByJudge)
              .sort(([, a], [, b]) => b - a)
              .map(([judge, count]) => (
                <div key={judge} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{judge}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{
                          width: `${(count / Math.max(...Object.values(feedbackByJudge))) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-8">{count}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Feedback by Score Type */}
      {Object.keys(feedbackByScoreType).length > 0 && (
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Feedback by Score Type</h3>
          <div className="space-y-3">
            {Object.entries(feedbackByScoreType)
              .sort(([, a], [, b]) => b - a)
              .map(([scoreType, count]) => (
                <div key={scoreType} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{scoreType}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500"
                        style={{
                          width: `${(count / Math.max(...Object.values(feedbackByScoreType))) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-8">{count}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {feedback.length === 0 && (
        <div className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
          <MessageSquare className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No feedback yet</h3>
          <p className="text-gray-600">
            Navigate to the Judge Consistency tab to start providing feedback on judge evaluations.
          </p>
        </div>
      )}
    </div>
  );
}
