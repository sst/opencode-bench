import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { EvaluationRunExport } from "../types/benchmark";
import { theme } from "../theme";

interface ScoreDistributionChartProps {
  runs: EvaluationRunExport[];
}

const chartConfig = {
  count: {
    label: "Count",
    color: theme.fillColor,
  },
} satisfies ChartConfig;

export function ScoreDistributionChart({ runs }: ScoreDistributionChartProps) {
  const data = useMemo(() => {
    // Create buckets for score distribution
    const buckets = [
      { range: "0-0.2", min: 0, max: 0.2, count: 0 },
      { range: "0.2-0.4", min: 0.2, max: 0.4, count: 0 },
      { range: "0.4-0.6", min: 0.4, max: 0.6, count: 0 },
      { range: "0.6-0.8", min: 0.6, max: 0.8, count: 0 },
      { range: "0.8-1.0", min: 0.8, max: 1.0, count: 0 },
    ];

    runs.forEach((run) => {
      const score = run.finalScore;
      for (const bucket of buckets) {
        if (score >= bucket.min && score < bucket.max) {
          bucket.count++;
          break;
        }
      }
    });

    return buckets.map((bucket) => ({
      range: bucket.range,
      count: bucket.count,
    }));
  }, [runs]);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold mb-4" style={{ color: theme.textPrimary, fontFamily: theme.fontFamily }}>
          Score Distribution
        </h3>
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-xl font-semibold mb-4" style={{ color: theme.textPrimary, fontFamily: theme.fontFamily }}>
        Score Distribution
      </h3>
      <ChartContainer config={chartConfig} className="!aspect-auto h-[300px] w-full">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
          <XAxis 
            dataKey="range" 
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 12 }}
          />
          <YAxis 
            tick={{ fill: theme.textSecondary, fontFamily: theme.fontFamily, fontSize: 12 }}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar 
            dataKey="count" 
            fill={theme.fillColor}
            stroke={theme.strokeColor}
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
