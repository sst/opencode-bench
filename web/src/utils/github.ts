const GITHUB_API = "https://api.github.com";
const REPO = "sst/opencode-bench";

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_sha: string;
  head_branch: string;
  conclusion: string;
  status: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  created_at: string;
  updated_at: string;
  expired: boolean;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  author: {
    login: string;
  };
}

export async function fetchLatestCommit(): Promise<GitHubCommit | null> {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${REPO}/commits?per_page=1`
    );
    if (!response.ok) return null;
    const commits = await response.json();
    return commits[0] || null;
  } catch (error) {
    console.error("Failed to fetch latest commit:", error);
    return null;
  }
}

export async function fetchWorkflowRunsForCommit(
  commitSha: string
): Promise<GitHubWorkflowRun[]> {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${REPO}/actions/runs?head_sha=${commitSha}&per_page=100`
    );
    if (!response.ok) {
      console.error(`Failed to fetch workflow runs: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.workflow_runs || [];
  } catch (error) {
    console.error("Failed to fetch workflow runs:", error);
    return [];
  }
}

export async function fetchArtifactsForRun(
  runId: number
): Promise<GitHubArtifact[]> {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${REPO}/actions/runs/${runId}/artifacts`
    );
    if (!response.ok) {
      console.error(`Failed to fetch artifacts: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.artifacts || [];
  } catch (error) {
    console.error("Failed to fetch artifacts:", error);
    return [];
  }
}

export async function fetchRecentCommits(limit: number = 20): Promise<GitHubCommit[]> {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${REPO}/commits?per_page=${limit}`
    );
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch recent commits:", error);
    return [];
  }
}
