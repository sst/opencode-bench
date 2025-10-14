import { strict as assert } from "node:assert";

import { request as octokitRequest } from "@octokit/request";
import type { RequestInterface } from "@octokit/types";

import type { DatasetEval } from "~/lib/dataset.js";
import type { PlannerCommitDiff } from "~/lib/planner.js";

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

function splitRepo(entry: DatasetEval): { owner: string; repo: string } {
  const [owner, repo] = entry.repo.split("/", 2);
  assert(owner && repo, `Invalid repo identifier: ${entry.repo}`);
  return { owner, repo };
}

export async function fetchComparisonDiff(entry: DatasetEval): Promise<string> {
  const client = getRequestClient();
  const { owner, repo } = splitRepo(entry);

  const response = await client(
    "GET /repos/{owner}/{repo}/compare/{base}...{head}",
    {
      owner,
      repo,
      base: entry.from,
      head: entry.to,
      headers: {
        accept: DIFF_ACCEPT_HEADER,
      },
    },
  );

  const diff = String(response.data);

  assert(
    diff.trim().length > 0,
    `GitHub comparison diff for ${entry.repo} between ${entry.from} and ${entry.to} was empty.`,
  );

  return diff;
}

export async function fetchPlannerCommitDiffs(
  entry: DatasetEval,
): Promise<PlannerCommitDiff[]> {
  const client = getRequestClient();
  const { owner, repo } = splitRepo(entry);

  const comparison = await client(
    "GET /repos/{owner}/{repo}/compare/{base}...{head}",
    {
      owner,
      repo,
      base: entry.from,
      head: entry.to,
    },
  );

  const comparisonData = comparison.data as {
    commits?: Array<{
      sha: string;
      commit?: { message?: string };
    }>;
  };

  // TODO: the indirect commit issue is back (check the first dataset)
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

        return {
          sha,
          title,
          diff,
        } satisfies PlannerCommitDiff;
      } catch (error) {
        console.error(
          `Failed to fetch diff for commit ${sha} in ${entry.repo}:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    }),
  );

  return results.filter((value): value is PlannerCommitDiff => value !== null);
}
