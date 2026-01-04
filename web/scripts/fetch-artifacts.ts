#!/usr/bin/env bun
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const REPO = "sst/opencode-bench";
const COMMIT_SHA = "ea446df3c3284cf6be379486a9807d0c48ef7d78";
const DATA_DIR = join(import.meta.dir, "..", "data");

// GitHub API base URL
const GITHUB_API = "https://api.github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

interface GitHubArtifact {
  id: number;
  node_id: string;
  name: string;
  size_in_bytes: number;
  url: string;
  archive_download_url: string;
  expired: boolean;
  created_at: string;
  updated_at: string;
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_sha: string;
  conclusion: string;
  status: string;
  created_at: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "opencode-bench-web",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function downloadArtifact(artifact: GitHubArtifact): Promise<void> {
  console.log(`Downloading artifact: ${artifact.name} (${(artifact.size_in_bytes / 1024 / 1024).toFixed(2)} MB)`);
  
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "opencode-bench-web",
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `token ${GITHUB_TOKEN}`;
  }

  const response = await fetch(artifact.archive_download_url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to download artifact ${artifact.name}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const zipPath = join(DATA_DIR, `${artifact.name}.zip`);
  writeFileSync(zipPath, Buffer.from(arrayBuffer));
  console.log(`Saved ZIP to: ${zipPath}`);

  // Extract the zip file
  const extractPath = join(DATA_DIR, artifact.name);
  mkdirSync(extractPath, { recursive: true });
  
  try {
    execSync(`unzip -q -o "${zipPath}" -d "${extractPath}"`, { stdio: "inherit" });
    console.log(`Extracted to: ${extractPath}`);
  } catch (error) {
    console.error(`Failed to extract ${artifact.name}:`, error);
    throw error;
  }
}

async function main() {
  console.log(`Fetching artifacts for commit ${COMMIT_SHA} from ${REPO}...`);
  
  if (!GITHUB_TOKEN) {
    console.warn("⚠️  Warning: GITHUB_TOKEN not set. Some artifacts may require authentication.");
    console.warn("   Set GITHUB_TOKEN environment variable if downloads fail.");
  }

  // Create data directory if it doesn't exist
  mkdirSync(DATA_DIR, { recursive: true });

  // Get workflow runs for this commit
  const runsUrl = `${GITHUB_API}/repos/${REPO}/actions/runs?head_sha=${COMMIT_SHA}&per_page=100`;
  console.log(`Fetching workflow runs: ${runsUrl}`);
  
  const runsData = await fetchJson<{ workflow_runs: GitHubWorkflowRun[] }>(runsUrl);
  
  if (runsData.workflow_runs.length === 0) {
    console.error("No workflow runs found for this commit");
    process.exit(1);
  }

  console.log(`Found ${runsData.workflow_runs.length} workflow run(s)`);

  // Log all runs for debugging
  for (const run of runsData.workflow_runs) {
    console.log(`  - ${run.id}: ${run.name} (${run.status}/${run.conclusion})`);
  }

  // Try to find the "Publish and Benchmark Preview Packages" workflow first
  let run = runsData.workflow_runs.find(r => 
    r.status === "completed" && r.name.includes("Publish and Benchmark")
  );
  
  // Fallback to any completed run
  if (!run) {
    run = runsData.workflow_runs.find(r => r.status === "completed");
  }
  
  // Fallback to most recent run
  if (!run) {
    run = runsData.workflow_runs[0];
  }
  
  if (!run) {
    console.error("No workflow run found");
    process.exit(1);
  }

  console.log(`\nUsing workflow run: ${run.id} (${run.name}) - Status: ${run.status}, Conclusion: ${run.conclusion}`);

  // Get artifacts for this run
  const artifactsUrl = `${GITHUB_API}/repos/${REPO}/actions/runs/${run.id}/artifacts`;
  console.log(`Fetching artifacts: ${artifactsUrl}`);
  
  const artifactsData = await fetchJson<{ artifacts: GitHubArtifact[] }>(artifactsUrl);
  
  if (artifactsData.artifacts.length === 0) {
    console.error("No artifacts found for this workflow run");
    process.exit(1);
  }

  console.log(`Found ${artifactsData.artifacts.length} artifact(s)`);

  // Download all artifacts
  for (const artifact of artifactsData.artifacts) {
    if (artifact.expired) {
      console.log(`Skipping expired artifact: ${artifact.name}`);
      continue;
    }

    try {
      await downloadArtifact(artifact);
    } catch (error) {
      console.error(`Error downloading ${artifact.name}:`, error);
    }
  }

  // Save metadata
  const metadata = {
    commit: COMMIT_SHA,
    workflowRun: {
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
    },
    artifacts: artifactsData.artifacts.map(a => ({
      name: a.name,
      size: a.size_in_bytes,
      createdAt: a.created_at,
      expired: a.expired,
    })),
    fetchedAt: new Date().toISOString(),
  };

  writeFileSync(
    join(DATA_DIR, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  );

  console.log("\n✅ Done! Artifacts downloaded to:", DATA_DIR);
  console.log(`📊 Metadata saved to: ${join(DATA_DIR, "metadata.json")}`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
