import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { EvaluationRunExport } from "../types/benchmark";
import { theme } from "../theme";

interface EpisodeScoreChartProps {
  run: EvaluationRunExport;
}

const chartConfig = {
  finalScore: {
    label: "Final Score",
    color: theme.strokeColor,
  },
  baseScore: {
    label: "Base Score",
    color: theme.textSecondary,
  },
} satisfies ChartConfig;

export function EpisodeScoreChart({ run }: EpisodeScoreChartProps) {
  const data = run.episodes.map((episode, index) => ({
    episode: `Episode ${index + 1}`,
    finalScore: episode.finalScore,
    baseScore: episode.baseScore,
  }));

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Episode Scores Over Time</h3>
        <p className="text-sm text-gray-500">Performance trends across multiple episodes</p>
      </div>
      <ChartContainer config={chartConfig} className="!aspect-auto h-[300px] w-full">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
          <XAxis 
            dataKey="episode"
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 12 }}
          />
          <YAxis 
            domain={[0, 1]}
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 12 }}
          />
          <ChartTooltip 
            content={<ChartTooltipContent />}
            formatter={(value: number) => `${(value * 100).toFixed(2)}%`}
          />
          <Line 
            type="monotone" 
            dataKey="finalScore" 
            stroke={theme.strokeColor}
            strokeWidth={2}
            dot={{ fill: theme.radarPointColor, r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="baseScore" 
            stroke={theme.textSecondary}
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: theme.textSecondary, r: 4 }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
