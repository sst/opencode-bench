import { useState, useEffect } from "react";
import type { BenchmarkData } from "./types/benchmark";
import { loadBenchmarkData } from "./utils/loadData";
import { fetchLatestCommit } from "./utils/github";
import { OverviewDashboard } from "./components/OverviewDashboard";
import { ComparisonMatrix } from "./components/ComparisonMatrix";
import { DetailedScoreView } from "./components/DetailedScoreView";
import { CommitSelector } from "./components/CommitSelector";
import "./App.css";

type View = "overview" | "comparison" | "detailed";

function App() {
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);

  // Fetch latest commit on mount
  useEffect(() => {
    async function init() {
      try {
        const latestCommit = await fetchLatestCommit();
        if (latestCommit) {
          setSelectedCommit(latestCommit.sha);
        } else {
          // Fallback to hardcoded commit if API fails
          setSelectedCommit("ea446df3c3284cf6be379486a9807d0c48ef7d78");
        }
      } catch (err) {
        console.error("Failed to fetch latest commit:", err);
        setSelectedCommit("ea446df3c3284cf6be379486a9807d0c48ef7d78");
      }
    }
    init();
  }, []);

  // Load data when commit is selected
  useEffect(() => {
    if (!selectedCommit) return;

    setLoading(true);
    setError(null);
    
    loadBenchmarkData(selectedCommit)
      .then((loadedData) => {
        setData(loadedData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [selectedCommit]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading benchmark data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p className="font-bold">Error loading data</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.runs.length === 0) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">No benchmark data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-8">
              <div className="flex-shrink-0">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                  OpenCode Benchmark
                </h1>
              </div>
              <div className="hidden md:flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setView("overview")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    view === "overview"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setView("comparison")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    view === "comparison"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Comparison
                </button>
                <button
                  onClick={() => setView("detailed")}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    view === "detailed"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Detailed
                </button>
              </div>
            </div>
            {selectedCommit && (
              <CommitSelector
                selectedCommit={selectedCommit}
                onCommitChange={setSelectedCommit}
              />
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {data.commitData && (
          <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl shadow-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-medium text-gray-700">Commit:</span>
                <code className="bg-white/80 px-3 py-1 rounded-md font-mono text-xs font-semibold text-gray-900 border border-blue-200">
                  {data.commitData.commitSha.slice(0, 7)}
                </code>
              </div>
              {data.commitData.workflowRun && (
                <a
                  href={data.commitData.workflowRun.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-900 font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Workflow
                </a>
              )}
            </div>
          </div>
        )}
        
        {view === "overview" && <OverviewDashboard runs={data.runs} />}
        {view === "comparison" && <ComparisonMatrix runs={data.runs} />}
        {view === "detailed" && <DetailedScoreView runs={data.runs} />}
        
        {/* Debug info */}
        {import.meta.env.DEV && (
          <div className="mt-8 p-4 bg-gray-100 rounded text-sm">
            <p>Loaded {data.runs.length} runs</p>
            {data.runs.length > 0 && (
              <p>First run: {data.runs[0].agent} / {data.runs[0].model}</p>
            )}
            {data.commitData && (
              <p>Commit: {data.commitData.commitSha}</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
