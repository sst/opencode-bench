import { strict as assert } from "node:assert";

import { request as octokitRequest } from "@octokit/request";
import type { RequestInterface } from "@octokit/types";

const DIFF_ACCEPT_HEADER = "application/vnd.github.v3.diff";

function resolveGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim();
}

const defaultHeaders: Record<string, string> = {
  "user-agent": "opencode-bench",
};

const token = resolveGitHubToken();
assert(
  token,
  "GITHUB_TOKEN is required to call the GitHub API. Set it before running the CLI.",
);
defaultHeaders.authorization = `Bearer ${token}`;

const requestClient: RequestInterface = octokitRequest.defaults({
  headers: defaultHeaders,
});

function getRequestClient(): RequestInterface {
  return requestClient;
}

export async function fetchComparisonDiff(
  owner: string,
  repo: string,
  from: string,
  to: string,
): Promise<string> {
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

  assert(
    diff.trim().length > 0,
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
