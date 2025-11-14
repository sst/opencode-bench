import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { EvaluationRunExport } from "../types/benchmark";
import { theme } from "../theme";

interface RadarScoreChartProps {
  run: EvaluationRunExport;
}

const chartConfig = {
  score: {
    label: "Score",
    color: theme.radarBorderColor,
  },
} satisfies ChartConfig;

export function RadarScoreChart({ run }: RadarScoreChartProps) {
  const data = run.scores.map((score) => ({
    assignment: score.assignment.name,
    score: score.averageScore,
  }));

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Score Breakdown by Assignment</h3>
        <p className="text-sm text-gray-500">Radar chart showing performance across different metrics</p>
      </div>
      <ChartContainer config={chartConfig} className="!aspect-auto h-[400px] w-full">
        <RadarChart data={data} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <PolarGrid stroke={theme.gridColor} />
          <PolarAngleAxis 
            dataKey="assignment" 
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 12 }}
          />
          <PolarRadiusAxis 
            angle={90}
            domain={[0, 1]}
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 10 }}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Radar
            name="Score"
            dataKey="score"
            stroke={theme.radarBorderColor}
            fill={theme.radarFillColor}
            fillOpacity={0.6}
            strokeWidth={2}
          />
        </RadarChart>
      </ChartContainer>
    </div>
  );
}
