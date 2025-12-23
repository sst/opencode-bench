import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { EvaluationRunExport } from "../types/benchmark";
import { theme } from "../theme";

interface AgentComparisonChartProps {
  runs: EvaluationRunExport[];
}

const chartConfig = {
  avgScore: {
    label: "Average Score",
    color: theme.fillColor,
  },
} satisfies ChartConfig;

export function AgentComparisonChart({ runs }: AgentComparisonChartProps) {
  const data = useMemo(() => {
    const agentMap = new Map<string, { total: number; count: number }>();
    
    runs.forEach((run) => {
      const agent = run.agent;
      const current = agentMap.get(agent) || { total: 0, count: 0 };
      current.total += run.finalScore;
      current.count += 1;
      agentMap.set(agent, current);
    });

    return Array.from(agentMap.entries())
      .map(([agent, { total, count }]) => ({
        agent,
        avgScore: total / count,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [runs]);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold mb-4" style={{ color: theme.textPrimary, fontFamily: theme.fontFamily }}>
          Average Score by Agent
        </h3>
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Average Score by Agent</h3>
        <p className="text-sm text-gray-500">Comparison of performance across different agents</p>
      </div>
      <ChartContainer config={chartConfig} className="!aspect-auto h-[300px] w-full">
        <BarChart data={data} layout="vertical" margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
          <XAxis 
            type="number"
            domain={[0, 1]}
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 12 }}
          />
          <YAxis 
            type="category"
            dataKey="agent"
            width={120}
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 12 }}
          />
          <ChartTooltip 
            content={<ChartTooltipContent />}
            formatter={(value: number) => `${(value * 100).toFixed(2)}%`}
          />
          <Bar 
            dataKey="avgScore" 
            fill={theme.fillColor}
            stroke={theme.strokeColor}
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
