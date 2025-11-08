interface CommitSelectorProps {
  selectedCommit: string;
  onCommitChange: (commitSha: string) => void;
}

export function CommitSelector({ selectedCommit }: CommitSelectorProps) {
  const shortSha = selectedCommit.slice(0, 7);

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-xl text-sm font-medium">
      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="text-gray-600 font-medium">Commit:</span>
      <code className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 px-3 py-1 rounded-lg text-xs font-mono font-bold text-blue-700">
        {shortSha}
      </code>
    </div>
  );
}
