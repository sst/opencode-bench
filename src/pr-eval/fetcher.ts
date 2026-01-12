import { fetchPullRequest, type PullRequestData } from "../util/github.js";
import { parsePrUrl } from "./parser.js";

const MAX_DIFF_LENGTH = 50000;

export interface PrEvalContext {
  url: string;
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  diff: string;
  diffTruncated: boolean;
  diffStats: {
    filesChanged: number;
    additions: number;
    deletions: number;
    totalLines: number;
  };
  commits: Array<{ sha: string; message: string }>;
  files: Array<{
    filename: string;
    status: string;
    changes: number;
  }>;
  hasTests: boolean;
  baseBranch: string;
  headBranch: string;
}

const TEST_FILE_PATTERNS = [
  /test[s]?\//i,
  /spec[s]?\//i,
  /__tests__\//i,
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /_test\.go$/i,
  /_test\.py$/i,
  /test_.*\.py$/i,
  /\.test\.rs$/i,
];

function isTestFile(filename: string): boolean {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(filename));
}

export async function fetchPrContext(prUrl: string): Promise<PrEvalContext> {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    throw new Error(`Invalid GitHub PR URL: ${prUrl}`);
  }

  const { owner, repo, prNumber } = parsed;

  let prData: PullRequestData;
  try {
    prData = await fetchPullRequest(owner, repo, prNumber);
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      throw new Error(
        `PR not found or not accessible: ${owner}/${repo}#${prNumber}. ` +
          `Make sure the repository is public and the PR exists.`,
      );
    }
    throw error;
  }

  let diff = prData.diff;
  let diffTruncated = false;
  if (diff.length > MAX_DIFF_LENGTH) {
    diff = diff.slice(0, MAX_DIFF_LENGTH);
    diffTruncated = true;
  }

  const hasTests = prData.files.some((f) => isTestFile(f.filename));

  return {
    url: prUrl,
    owner,
    repo,
    prNumber,
    title: prData.title,
    body: prData.body,
    diff,
    diffTruncated,
    diffStats: {
      filesChanged: prData.changedFiles,
      additions: prData.additions,
      deletions: prData.deletions,
      totalLines: prData.additions + prData.deletions,
    },
    commits: prData.commitMessages,
    files: prData.files.map((f) => ({
      filename: f.filename,
      status: f.status,
      changes: f.changes,
    })),
    hasTests,
    baseBranch: prData.baseBranch,
    headBranch: prData.headBranch,
  };
}
