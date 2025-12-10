import { useMemo } from "react";
import type { EvaluationRunExport } from "../types/benchmark";
import { calculateStats, getTopPerformers } from "../utils/loadData";
import { AgentComparisonChart } from "./AgentComparisonChart";
import { ModelComparisonChart } from "./ModelComparisonChart";

interface OverviewDashboardProps {
  runs: EvaluationRunExport[];
}

export function OverviewDashboard({ runs }: OverviewDashboardProps) {
  const stats = useMemo(() => calculateStats(runs), [runs]);
  const topPerformers = useMemo(() => getTopPerformers(runs, 10), [runs]);

  const formatScore = (score: number) => (score * 100).toFixed(2);
  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(2)}K`;
    return tokens.toLocaleString();
  };

  return (
    <div className="overview-dashboard">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
          Benchmark Overview
        </h1>
        <p className="text-gray-600">Performance metrics and comparisons across all benchmark runs</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <SummaryCard
          title="Total Runs"
          value={stats.totalRuns}
          icon="📊"
          gradient="from-blue-500 to-blue-600"
        />
        <SummaryCard
          title="Total Episodes"
          value={stats.totalEpisodes}
          icon="🎬"
          gradient="from-purple-500 to-purple-600"
        />
        <SummaryCard
          title="Avg Score"
          value={`${formatScore(stats.avgScore)}%`}
          icon="⭐"
          gradient="from-yellow-500 to-orange-500"
        />
        <SummaryCard
          title="Total Tokens"
          value={formatTokens(stats.totalInputTokens + stats.totalOutputTokens)}
          icon="💬"
          gradient="from-green-500 to-emerald-600"
        />
      </div>

      {/* Top Performers Leaderboard */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-2xl">
            🏆
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Top Performers</h2>
            <p className="text-sm text-gray-500">Best performing agent/model combinations</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rank</th>
                <th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                <th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Model</th>
                <th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Evaluation</th>
                <th className="text-right p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Final Score</th>
                <th className="text-right p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Base Score</th>
                <th className="text-right p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topPerformers.map((performer, index) => (
                <tr
                  key={`${performer.agent}-${performer.model}-${performer.evaluation}`}
                  className="hover:bg-gray-50/50 transition-colors"
                >
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {index < 3 && (
                        <span className="text-xl">
                          {index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}
                        </span>
                      )}
                      <span className="font-bold text-gray-900">#{index + 1}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm">
                      {performer.agent}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="text-sm font-medium text-gray-700">
                      {performer.model.replace("/", ":")}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="text-sm text-gray-600 max-w-xs truncate block">
                      {performer.evaluation}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <span className="inline-flex items-center px-3 py-1 rounded-lg bg-green-50 text-green-700 font-bold text-sm">
                      {formatScore(performer.score)}%
                    </span>
                  </td>
                  <td className="p-4 text-right text-sm text-gray-600 font-medium">
                    {formatScore(performer.baseScore)}%
                  </td>
                  <td className="p-4 text-right">
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700">
                      -{formatScore(performer.variancePenalty)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent and Model Comparison Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <AgentComparisonChart runs={runs} />
        <ModelComparisonChart runs={runs} />
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Input Tokens"
          value={formatTokens(stats.totalInputTokens)}
          description="Total input tokens consumed"
        />
        <StatCard
          title="Output Tokens"
          value={formatTokens(stats.totalOutputTokens)}
          description="Total output tokens generated"
        />
        <StatCard
          title="Avg Variance Penalty"
          value={`${formatScore(stats.avgVariancePenalty)}%`}
          description="Average penalty for score variance"
        />
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  gradient,
}: {
  title: string;
  value: string | number;
  icon: string;
  gradient: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 hover:shadow-xl transition-shadow duration-200">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-2">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-3xl shadow-lg`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  color = "blue",
}: {
  title: string;
  value: string;
  description: string;
  color?: "blue" | "purple" | "red" | "green";
}) {
  const colorClasses = {
    blue: "from-blue-50 to-blue-100 border-blue-200",
    purple: "from-purple-50 to-purple-100 border-purple-200",
    red: "from-red-50 to-red-100 border-red-200",
    green: "from-green-50 to-green-100 border-green-200",
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-xl border p-5 hover:shadow-md transition-shadow`}>
      <h3 className="font-semibold text-gray-700 mb-2 text-sm">{title}</h3>
      <p className="text-3xl font-bold text-gray-900 mb-2">{value}</p>
      <p className="text-xs text-gray-600">{description}</p>
    </div>
  );
}
