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
