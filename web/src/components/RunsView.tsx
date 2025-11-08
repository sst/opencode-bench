import { DetailedScoreView } from "./DetailedScoreView";
import type { EvaluationRunExport, CommitData } from "../types/benchmark";

interface RunsViewProps {
  runs: EvaluationRunExport[];
  commitData?: CommitData;
}

export function RunsView({ runs }: RunsViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Run Analysis</h2>
          <p className="text-gray-600 mt-1">
            Deep dive into agent performance across episodes and judges
          </p>
        </div>
      </div>

      <DetailedScoreView runs={runs} />
    </div>
  );
}
