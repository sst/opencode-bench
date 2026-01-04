import { useState } from "react";
import type { EvaluationRunExport } from "../types/benchmark";
import { RadarScoreChart } from "./RadarScoreChart";
import { EpisodeScoreChart } from "./EpisodeScoreChart";
import { JudgeComparisonView } from "./JudgeComparisonView";

interface DetailedScoreViewProps {
  runs: EvaluationRunExport[];
}

export function DetailedScoreView({ runs }: DetailedScoreViewProps) {
  const [selectedRun, setSelectedRun] = useState<EvaluationRunExport | null>(
    runs[0] || null
  );
  const [selectedEpisode, setSelectedEpisode] = useState(0);

  const formatScore = (score: number) => (score * 100).toFixed(2);

  if (!selectedRun) {
    return <div className="p-4">No benchmark data available</div>;
  }

  const currentEpisode = selectedRun.episodes[selectedEpisode];

  return (
    <div className="detailed-score-view">
      <h2 className="text-2xl font-bold mb-4">Detailed Score Breakdown</h2>

      {/* Run Selector */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Select Run:
        </label>
        <select
          value={runs.indexOf(selectedRun)}
          onChange={(e) => setSelectedRun(runs[parseInt(e.target.value)])}
          className="w-full max-w-2xl px-4 py-3 bg-white border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all font-medium"
        >
          {runs.map((run, index) => (
            <option key={index} value={index}>
              {run.agent} / {run.model.replace("/", ":")} / {run.evaluation.repo}
            </option>
          ))}
        </select>
      </div>

      {/* Run Summary */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-600">Final Score</p>
            <p className="text-2xl font-bold">{formatScore(selectedRun.finalScore)}%</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Base Score</p>
            <p className="text-2xl font-bold text-blue-600">
              {formatScore(selectedRun.baseScore)}%
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Variance Penalty</p>
            <p className="text-2xl font-bold text-red-600">
              -{formatScore(selectedRun.variancePenalty)}%
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Episodes</p>
            <p className="text-2xl font-bold">{selectedRun.episodes.length}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm text-gray-600 mb-2">Usage</p>
          <div className="flex gap-4 text-sm">
            <span>Input: {selectedRun.usage.input.toLocaleString()} tokens</span>
            <span>Output: {selectedRun.usage.output.toLocaleString()} tokens</span>
            <span>
              Total: {(selectedRun.usage.input + selectedRun.usage.output).toLocaleString()} tokens
            </span>
          </div>
        </div>

        <div className="mt-4">
          <a
            href={selectedRun.jobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline text-sm"
          >
            View GitHub Actions Job →
          </a>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <RadarScoreChart run={selectedRun} />
        <EpisodeScoreChart run={selectedRun} />
      </div>

      {/* Episode Selector */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
        <h3 className="text-xl font-bold mb-4 text-gray-900">Episode Analysis</h3>
        <div className="flex gap-2 mb-4">
          {selectedRun.episodes.map((episode, index) => (
            <button
              key={index}
              onClick={() => setSelectedEpisode(index)}
              className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                selectedEpisode === index
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-sm font-semibold text-gray-700 mb-1">
                Episode {index}
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {formatScore(episode.finalScore)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Variance: {episode.variancePenalty.toFixed(3)}
              </div>
            </button>
          ))}
        </div>

        {currentEpisode && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Base Score:</span>
                <span className="ml-2 font-semibold">{formatScore(currentEpisode.baseScore)}%</span>
              </div>
              <div>
                <span className="text-gray-600">Input Tokens:</span>
                <span className="ml-2 font-semibold">{currentEpisode.usage.input.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-600">Output Tokens:</span>
                <span className="ml-2 font-semibold">{currentEpisode.usage.output.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Judge Comparison by Score Type */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-6">
        <h3 className="text-2xl font-bold mb-6 text-gray-900">
          Judge Evaluations - Episode {selectedEpisode}
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Compare how all judges evaluated this episode across each score dimension.
        </p>
        <div className="space-y-8">
          {currentEpisode?.scores.map((scoreResult, index) => (
            <JudgeComparisonView
              key={index}
              score={scoreResult}
              episodeIndex={selectedEpisode}
              evalRepo={selectedRun.evaluation.repo}
              benchmarkCommit=""
              agentModel={`${selectedRun.agent}:${selectedRun.model}`}
            />
          ))}
        </div>
      </div>

      {/* Aggregate Score Breakdown (kept for reference) */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-6">
        <h3 className="text-2xl font-bold mb-6 text-gray-900">Aggregate Score Breakdown</h3>
        <p className="text-sm text-gray-600 mb-4">Average across all episodes</p>
        <div className="space-y-4">
          {selectedRun.scores.map((scoreResult, index) => (
            <ScoreAssignmentCard
              key={index}
              scoreResult={scoreResult}
              formatScore={formatScore}
            />
          ))}
        </div>
      </div>

      {/* Summary */}
      {selectedRun.summary && (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <h3 className="text-2xl font-bold mb-6 text-gray-900">Summary</h3>
          <div className="prose max-w-none">
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-mono">{selectedRun.summary}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreAssignmentCard({
  scoreResult,
  formatScore,
}: {
  scoreResult: EvaluationRunExport["scores"][0];
  formatScore: (score: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h4 className="font-semibold">{scoreResult.assignment.name}</h4>
          <div className="flex gap-4 mt-2 text-sm">
            <span>
              Avg Score:{" "}
              <span className="font-semibold">
                {formatScore(scoreResult.averageScore)}%
              </span>
            </span>
            <span>
              Weight:{" "}
              <span className="font-semibold">
                {formatScore(scoreResult.normalizedWeight)}%
              </span>
            </span>
            <span>
              Variance:{" "}
              <span className="font-semibold">
                {formatScore(scoreResult.variance)}
              </span>
            </span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-4 px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
        >
          {expanded ? "Hide" : "Show"} Judges ({scoreResult.judges.length})
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t pt-4">
          {scoreResult.judges.map((judge, index) => (
            <JudgeCard key={index} judge={judge} />
          ))}
        </div>
      )}
    </div>
  );
}

function JudgeCard({
  judge,
}: {
  judge: EvaluationRunExport["scores"][0]["judges"][0];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-50 rounded p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{judge.name}</span>
          <span className="text-sm text-gray-600 ml-2">({judge.model})</span>
          <span
            className={`ml-3 px-2 py-1 rounded text-sm font-semibold ${
              judge.score === 1
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {judge.score === 1 ? "✓ Pass" : "✗ Fail"}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 hover:underline"
        >
          {expanded ? "Hide" : "Show"} Rationale
        </button>
      </div>

      {expanded && (
        <div className="mt-3 p-3 bg-white rounded border text-sm">
          <pre className="whitespace-pre-wrap">{judge.rationale}</pre>
        </div>
      )}
    </div>
  );
}
