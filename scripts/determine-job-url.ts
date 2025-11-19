#!/usr/bin/env bun
/**
 * Determines the HTML URL for a GitHub Actions job within the current run.
 *
 * Usage:
 *   bun run scripts/determine-job-url.ts --pattern "Benchmark agent / model / eval"
 */

import process from "node:process";

import { request as octokitRequest } from "@octokit/request";
import type { Endpoints } from "@octokit/types";

type ListWorkflowJobsResponse =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"]["response"]["data"];
type WorkflowJob = NonNullable<ListWorkflowJobsResponse["jobs"]>[number];

function usage(): void {
  console.error(
    "Usage: bun run scripts/determine-job-url.ts --pattern \"<job name substring>\"",
  );
  console.error("");
  console.error("Looks up the job URL from the current workflow run.");
}

function parseArgs(argv: string[]): { pattern: string } {
  let pattern: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pattern") {
      pattern = argv[index + 1];
      index += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(1);
    }
  }

  if (!pattern) {
    usage();
    process.exit(1);
  }

  return { pattern };
}

async function fetchJobs(
  owner: string,
  repo: string,
  runId: number,
): Promise<WorkflowJob[]> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to call the GitHub API.");
  }

  const request = octokitRequest.defaults({
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "opencode-bench/job-url",
    },
  });

  const jobs: WorkflowJob[] = [];
  const perPage = 100;
  let page = 1;

  // GitHub caps pagination at 100 items per page. Loop until a page returns fewer rows.
  while (true) {
    const response = await request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
      {
        owner,
        repo,
        run_id: runId,
        per_page: perPage,
        page,
      },
    );

    const data = response.data as ListWorkflowJobsResponse;
    const batch = data.jobs ?? [];
    jobs.push(...batch);

    if (batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return jobs;
}

async function main(): Promise<void> {
  const repoSlug = process.env.GITHUB_REPOSITORY;
  const runIdRaw = process.env.GITHUB_RUN_ID;

  if (!repoSlug || !runIdRaw) {
    throw new Error(
      "GITHUB_REPOSITORY and GITHUB_RUN_ID must be defined in the environment.",
    );
  }

  const runId = Number(runIdRaw);
  if (!Number.isFinite(runId)) {
    throw new Error(`Invalid GITHUB_RUN_ID value: ${runIdRaw}`);
  }

  const [owner, repo] = repoSlug.split("/", 2);
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repoSlug}`);
  }

  const { pattern } = parseArgs(process.argv.slice(2));
  const jobs = await fetchJobs(owner, repo, runId);

  if (jobs.length === 0) {
    throw new Error("No jobs were returned for the current workflow run.");
  }

  const match = jobs.find((job) => job.name?.includes(pattern));

  if (!match) {
    console.error(
      `Failed to find a job whose name contains "${pattern}". Available jobs:`,
    );
    for (const job of jobs) {
      console.error(`- ${job.name} [status=${job.status}]`);
    }
    process.exit(1);
  }

  if (!match.html_url) {
    throw new Error(`Job ${match.id} is missing an html_url field.`);
  }

  process.stdout.write(`${match.html_url}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
