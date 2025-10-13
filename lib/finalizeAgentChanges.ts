import { execSync } from "node:child_process";

import type { DatasetEval } from "~/lib/dataset.js";

export function finalizeAgentChanges(
  entry: DatasetEval,
  cwd: string,
  baselineCommit: string,
): boolean {
  try {
    execSync(`git config user.email "opencode-bench@example.com"`, {
      cwd,
      stdio: "ignore",
    });
    execSync(`git config user.name "Opencode Bench Agent"`, {
      cwd,
      stdio: "ignore",
    });
  } catch (error) {
    console.error(
      "Failed to configure git user for agent diff:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    execSync(`git add --all`, {
      cwd,
      stdio: "ignore",
    });
  } catch (error) {
    console.error(
      "Failed to stage agent changes:",
      error instanceof Error ? error.message : error,
    );
  }

  let hasStagedChanges = false;
  try {
    execSync(`git diff --cached --quiet`, {
      cwd,
      stdio: "ignore",
    });
  } catch {
    hasStagedChanges = true;
  }

  if (hasStagedChanges) {
    try {
      execSync(`git commit --no-verify -m "opencode-bench-agent-snapshot"`, {
        cwd,
        stdio: "ignore",
      });
    } catch (error) {
      console.error(
        "Failed to commit agent changes:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  try {
    execSync(`git diff --exit-code ${baselineCommit} HEAD`, {
      cwd,
      stdio: "ignore",
    });
    return false;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: number }).status === 1
    ) {
      return true;
    }

    console.error(
      "Failed to check final agent diff:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
