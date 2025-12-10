import { useState } from "react";
import type { EvaluationRunExport, CommitData } from "../types/benchmark";
import { JudgeConsistencyTab } from "./error-analysis/JudgeConsistencyTab";
import { CommunityDashboardTab } from "./error-analysis/CommunityDashboardTab";
import { Scale, BarChart2 } from "lucide-react";

interface ErrorAnalysisViewProps {
  runs: EvaluationRunExport[];
  commitData?: CommitData;
}

type Tab = "judge-consistency" | "community-dashboard";

export function ErrorAnalysisView({ runs, commitData }: ErrorAnalysisViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("judge-consistency");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Error Analysis</h2>
        <p className="text-gray-600 mt-1">
          Community-driven evaluation quality monitoring
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("judge-consistency")}
            className={`flex-1 p-4 rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeTab === "judge-consistency"
                ? "bg-blue-50 border-2 border-blue-500 text-blue-700"
                : "border-2 border-transparent hover:bg-gray-50 text-gray-600"
            }`}
          >
            <Scale className="w-5 h-5" />
            <div className="text-left">
              <div className="font-semibold">Judge Consistency</div>
              <div className="text-xs opacity-75">Review judge evaluations</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("community-dashboard")}
            className={`flex-1 p-4 rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeTab === "community-dashboard"
                ? "bg-blue-50 border-2 border-blue-500 text-blue-700"
                : "border-2 border-transparent hover:bg-gray-50 text-gray-600"
            }`}
          >
            <BarChart2 className="w-5 h-5" />
            <div className="text-left">
              <div className="font-semibold">Community Dashboard</div>
              <div className="text-xs opacity-75">Feedback statistics</div>
            </div>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "judge-consistency" && (
          <JudgeConsistencyTab runs={runs} commitData={commitData} />
        )}
        {activeTab === "community-dashboard" && (
          <CommunityDashboardTab runs={runs} />
        )}
      </div>
    </div>
  );
}
