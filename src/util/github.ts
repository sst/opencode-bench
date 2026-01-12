import { request as octokitRequest } from "@octokit/request";

const DIFF_ACCEPT_HEADER = "application/vnd.github.v3.diff";

let client: ReturnType<typeof octokitRequest.defaults>;

function getRequestClient() {
  if (client) return client;
  client = octokitRequest.defaults({
    headers: {
      "user-agent": "opencode-bench",
      authorization: `Bearer ${process.env.GITHUB_TOKEN?.trim()}`,
    },
  });
  return client;
}

export async function fetchComparisonDiff(
  owner: string,
  repo: string,
  from: string,
  to: string,
) {
  const client = getRequestClient();

  const response = await client(
    "GET /repos/{owner}/{repo}/compare/{base}...{head}",
    {
      owner,
      repo,
      base: from,
      head: to,
      headers: {
        accept: DIFF_ACCEPT_HEADER,
      },
    },
  );

  const diff = String(response.data);

  if (diff.trim().length === 0)
    throw new Error(
      `GitHub comparison diff for ${owner}/${repo} between ${from} and ${to} was empty.`,
    );

  return diff;
}

export interface CommitDiff {
  sha: string;
  title: string;
  diff: string;
}

export async function fetchCommits(
  owner: string,
  repo: string,
  from: string,
  to: string,
) {
  const client = getRequestClient();

  const comparison = await client(
    "GET /repos/{owner}/{repo}/compare/{base}...{head}",
    {
      owner,
      repo,
      base: from,
      head: to,
    },
  );

  const comparisonData = comparison.data as {
    commits?: Array<{
      sha: string;
      commit?: { message?: string };
    }>;
  };

  const commits = Array.isArray(comparisonData.commits)
    ? comparisonData.commits
    : [];

  if (commits.length === 0) {
    return [];
  }

  const results = await Promise.all(
    commits.map(async (commit) => {
      const sha = commit.sha;
      const title =
        commit.commit?.message?.split("\n", 1)[0]?.trim() ||
        "(no commit title)";

      try {
        const diffResponse = await client(
          "GET /repos/{owner}/{repo}/commits/{ref}",
          {
            owner,
            repo,
            ref: sha,
            headers: {
              accept: DIFF_ACCEPT_HEADER,
            },
          },
        );

        const diff = String(diffResponse.data);
        if (diff.trim().length === 0) {
          return null;
        }

        return { sha, title, diff };
      } catch (error) {
        console.error(
          `Failed to fetch diff for commit ${sha} in ${owner}/${repo}:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    }),
  );

  return results.filter((value): value is CommitDiff => value !== null);
}

export interface PullRequestData {
  number: number;
  title: string;
  body: string;
  state: string;
  baseBranch: string;
  headBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  diff: string;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  commitMessages: Array<{ sha: string; message: string }>;
}

export async function fetchPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestData> {
  const client = getRequestClient();

  // Fetch PR metadata
  const prResponse = await client("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: prNumber,
  });

  const prData = prResponse.data as {
    number: number;
    title: string;
    body: string | null;
    state: string;
    base: { ref: string };
    head: { ref: string };
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
  };

  // Fetch PR diff
  const diffResponse = await client("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: prNumber,
    headers: {
      accept: DIFF_ACCEPT_HEADER,
    },
  });

  const diff = String(diffResponse.data);

  // Fetch PR files
  const filesResponse = await client("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const files = (filesResponse.data as Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>).map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
  }));

  // Fetch PR commits
  const commitsResponse = await client("GET /repos/{owner}/{repo}/pulls/{pull_number}/commits", {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const commitMessages = (commitsResponse.data as Array<{
    sha: string;
    commit: { message: string };
  }>).map((c) => ({
    sha: c.sha,
    message: c.commit.message,
  }));

  return {
    number: prData.number,
    title: prData.title,
    body: prData.body ?? "",
    state: prData.state,
    baseBranch: prData.base.ref,
    headBranch: prData.head.ref,
    additions: prData.additions,
    deletions: prData.deletions,
    changedFiles: prData.changed_files,
    commits: prData.commits,
    diff,
    files,
    commitMessages,
  };
}

export async function addIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const client = getRequestClient();

  await client("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function addIssueLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
): Promise<void> {
  const client = getRequestClient();

  await client("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
    owner,
    repo,
    issue_number: issueNumber,
    labels,
  });
}
