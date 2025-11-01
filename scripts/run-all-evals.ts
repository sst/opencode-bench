#!/usr/bin/env bun
/**
 * Run All Evaluations Script
 *
 * Runs benchmarks for all evaluations in dataset.yaml sequentially.
 * This is the local equivalent of the GitHub Actions matrix strategy,
 * but runs one eval at a time instead of in parallel.
 *
 * Usage:
 *   bun run scripts/run-all-evals.ts --model opencode/claude-sonnet-4-5
 *   bun run scripts/run-all-evals.ts --model opencode/claude-sonnet-4-5 --output-dir my-results/
 *   bun run scripts/run-all-evals.ts --model opencode/claude-sonnet-4-5 --no-merge
 */

import { execSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import YAML from "yaml";
import type { EvaluationRunExport } from "~/types/export.js";

interface DatasetEntry {
  repo: string;
}

interface CliOptions {
  model: string;
  agent: string;
  outputDir: string;
  merge: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let model: string | undefined;
  let agent = "opencode"; // default agent
  let outputDir = "results";
  let merge = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--model") {
      model = args[++i];
    } else if (arg === "--agent") {
      agent = args[++i];
    } else if (arg === "--output-dir") {
      outputDir = args[++i];
    } else if (arg === "--no-merge") {
      merge = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: bun run scripts/run-all-evals.ts --model <model> [options]");
      console.log("");
      console.log("Options:");
      console.log("  --model <model>        Model to use (required)");
      console.log("  --agent <agent>        Agent to use (default: opencode)");
      console.log("  --output-dir <dir>     Output directory (default: results)");
      console.log("  --no-merge             Skip merging results into single file");
      console.log("  --help, -h             Show this help message");
      console.log("");
      console.log("Examples:");
      console.log("  bun run scripts/run-all-evals.ts --model opencode/claude-sonnet-4-5");
      console.log("  bun run scripts/run-all-evals.ts --model opencode/claude-sonnet-4-5 --output-dir my-results/");
      process.exit(0);
    }
  }

  if (!model) {
    console.error("Error: --model is required");
    console.error("Run with --help for usage information");
    process.exit(1);
  }

  return { model, agent, outputDir, merge };
}

function loadDataset(): DatasetEntry[] {
  const datasetPath = new URL("../dataset.yaml", import.meta.url);
  const raw = readFileSync(datasetPath, "utf8");
  const parsed = YAML.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("dataset.yaml must contain an array.");
  }

  return parsed
    .map((entry) => entry?.repo)
    .filter((repo): repo is string => typeof repo === "string" && repo.length > 0)
    .map((repo) => ({ repo }));
}

function slugify(text: string): string {
  return text.replace(/\//g, "-");
}

function runBenchmark(
  agent: string,
  model: string,
  evalRepo: string,
  outputPath: string
): boolean {
  const command = `node dist/cli.js ${agent} --eval "${evalRepo}" --model "${model}" --output "${outputPath}"`;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Running: ${command}`);
  console.log("=".repeat(80));

  try {
    execSync(command, {
      stdio: "inherit",
      env: process.env,
    });
    return true;
  } catch (error) {
    console.error(`\nError running benchmark for ${evalRepo}:`);
    if (error instanceof Error) {
      console.error(error.message);
    }
    return false;
  }
}

function mergeResults(outputDir: string, mergedPath: string): void {
  console.log(`\n${"=".repeat(80)}`);
  console.log("Merging results...");
  console.log("=".repeat(80));

  try {
    const command = `bun run scripts/merge-benchmark-exports.ts "${outputDir}" "${mergedPath}"`;
    execSync(command, {
      stdio: "inherit",
      env: process.env,
    });
    console.log(`\nMerged results written to: ${mergedPath}`);
  } catch (error) {
    console.error("\nError merging results:");
    if (error instanceof Error) {
      console.error(error.message);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const dataset = loadDataset();

  console.log("=".repeat(80));
  console.log("RUN ALL EVALUATIONS");
  console.log("=".repeat(80));
  console.log(`Agent:       ${options.agent}`);
  console.log(`Model:       ${options.model}`);
  console.log(`Output Dir:  ${options.outputDir}`);
  console.log(`Evaluations: ${dataset.length}`);
  console.log(`Merge:       ${options.merge ? "yes" : "no"}`);
  console.log("=".repeat(80));

  // Create output directory
  const outputDir = resolve(options.outputDir);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    console.log(`\nCreated output directory: ${outputDir}`);
  }

  // Track results
  const results: { eval: string; success: boolean; outputPath: string }[] = [];

  // Run benchmarks sequentially
  for (let i = 0; i < dataset.length; i++) {
    const entry = dataset[i];
    const evalRepo = entry.repo;
    const slug = slugify(evalRepo);
    const outputPath = join(outputDir, `${slug}.json`);

    console.log(`\n[${"#".repeat(40)}]`);
    console.log(`Progress: ${i + 1}/${dataset.length}`);
    console.log(`Evaluation: ${evalRepo}`);
    console.log(`Output: ${outputPath}`);
    console.log(`[${"#".repeat(40)}]`);

    const success = runBenchmark(options.agent, options.model, evalRepo, outputPath);

    results.push({
      eval: evalRepo,
      success,
      outputPath,
    });

    if (success) {
      console.log(`\n✅ SUCCESS: ${evalRepo}`);
    } else {
      console.log(`\n❌ FAILED: ${evalRepo}`);
    }
  }

  // Merge results if requested
  if (options.merge) {
    const mergedPath = join(outputDir, "benchmark.json");
    mergeResults(outputDir, mergedPath);
  }

  // Print summary
  console.log(`\n${"=".repeat(80)}`);
  console.log("SUMMARY");
  console.log("=".repeat(80));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`Total:      ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed:     ${failed.length}`);
  console.log();

  if (successful.length > 0) {
    console.log("Successful evaluations:");
    successful.forEach((r) => {
      console.log(`  ✅ ${r.eval}`);
      console.log(`     → ${r.outputPath}`);
    });
    console.log();
  }

  if (failed.length > 0) {
    console.log("Failed evaluations:");
    failed.forEach((r) => {
      console.log(`  ❌ ${r.eval}`);
    });
    console.log();
  }

  console.log("=".repeat(80));

  // Exit with error code if any failed
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
