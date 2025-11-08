import { useState, useEffect } from "react";
import { fetchRecentCommits, fetchLatestCommit, type GitHubCommit } from "../utils/github";

interface CommitSelectorProps {
  selectedCommit: string;
  onCommitChange: (commitSha: string) => void;
}

export function CommitSelector({ selectedCommit, onCommitChange }: CommitSelectorProps) {
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    async function loadCommits() {
      try {
        const latestCommit = await fetchLatestCommit();
        const recentCommits = await fetchRecentCommits(30);
        
        // Ensure latest commit is first
        const allCommits = latestCommit 
          ? [latestCommit, ...recentCommits.filter(c => c.sha !== latestCommit.sha)]
          : recentCommits;
        
        setCommits(allCommits);
      } catch (error) {
        console.error("Failed to load commits:", error);
      } finally {
        setLoading(false);
      }
    }
    
    loadCommits();
  }, []);

  const selectedCommitData = commits.find(c => c.sha === selectedCommit);
  const shortSha = selectedCommit.slice(0, 7);
  const commitMessage = selectedCommitData?.commit.message.split("\n")[0] || "";

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all text-sm font-medium"
        disabled={loading}
      >
        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-gray-600 font-medium">Commit:</span>
        <code className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 px-3 py-1 rounded-lg text-xs font-mono font-bold text-blue-700">
          {loading ? "Loading..." : shortSha}
        </code>
        {selectedCommitData && (
          <span className="text-gray-600 truncate max-w-xs hidden lg:inline">
            {commitMessage}
          </span>
        )}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full right-0 mt-2 w-[600px] max-h-[500px] overflow-y-auto bg-white border-2 border-gray-200 rounded-2xl shadow-2xl z-20">
            <div className="p-3">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider px-3 py-2 mb-2">
                Recent Commits
              </div>
              <div className="space-y-1">
                {commits.map((commit) => {
                  const isSelected = commit.sha === selectedCommit;
                  const shortMessage = commit.commit.message.split("\n")[0];
                  const date = new Date(commit.commit.author.date).toLocaleDateString();
                  
                  return (
                    <button
                      key={commit.sha}
                      onClick={() => {
                        onCommitChange(commit.sha);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
                        isSelected 
                          ? "bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 shadow-sm" 
                          : "hover:bg-gray-50 border-2 border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <code className={`text-xs font-mono px-2.5 py-1 rounded-lg font-bold ${
                          isSelected 
                            ? "bg-blue-100 text-blue-700 border border-blue-200" 
                            : "bg-gray-100 text-gray-700"
                        }`}>
                          {commit.sha.slice(0, 7)}
                        </code>
                        <span className="text-xs text-gray-500 font-medium">{date}</span>
                        {commit.sha === commits[0]?.sha && (
                          <span className="text-xs bg-gradient-to-r from-green-500 to-emerald-600 text-white px-2 py-1 rounded-full font-semibold shadow-sm">
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium text-gray-900 truncate mb-1">
                        {shortMessage}
                      </div>
                      <div className="text-xs text-gray-500">
                        {commit.author.login}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
