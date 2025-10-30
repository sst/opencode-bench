/**
 * Script to generate prompts for dataset entries that don't have them
 *
 * Usage:
 *   bun run scripts/generate-prompts.ts --all
 *   bun run scripts/generate-prompts.ts --repo owner/name
 *   bun run scripts/generate-prompts.ts --repo owner/name --force
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { strict as assert } from "node:assert";

import { generateSinglePrompt } from "~/lib/planner.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import type { DatasetEval } from "~/lib/dataset.js";

const DATASET_PATH = "dataset.yaml";

interface CliOptions {
  all: boolean;
  repo?: string;
  force: boolean;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    all: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--repo") {
      i++;
      assert(args[i], "Option --repo requires a value");
      options.repo = args[i];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert(
    options.all || options.repo,
    "Must specify either --all or --repo <owner/name>",
  );

  return options;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log("Usage:");
    console.log("  bun run scripts/generate-prompts.ts --all");
    console.log("  bun run scripts/generate-prompts.ts --repo owner/name");
    console.log("  bun run scripts/generate-prompts.ts --repo owner/name --force");
    console.log("");
    console.log("Options:");
    console.log("  --all          Generate prompts for all entries without prompts");
    console.log("  --repo <name>  Generate prompt for specific repo");
    console.log("  --force        Regenerate prompt even if it exists");
    return;
  }

  const options = parseCliOptions(args);

  // Read the raw YAML file
  const yamlContent = readFileSync(DATASET_PATH, "utf-8");
  const rawData = parseYaml(yamlContent) as Array<Record<string, unknown>>;

  assert(Array.isArray(rawData), "dataset.yaml must contain an array");

  let updated = false;

  for (const entry of rawData) {
    const repo = entry.repo as string;
    const from = entry.from as string;
    const to = entry.to as string;
    const existingPrompt = entry.prompt as string | undefined;

    // Skip if not matching filter
    if (!options.all && options.repo !== repo) {
      continue;
    }

    // Skip if prompt exists and not forcing
    if (existingPrompt && !options.force) {
      console.log(`[${repo}] Skipping - prompt already exists`);
      continue;
    }

    console.log(`[${repo}] Generating prompt...`);

    try {
      // Create a DatasetEval object for the entry
      const evalEntry: DatasetEval = {
        repo,
        from,
        to,
        issues: (entry.issues as number[]) || [],
        scores: [],
        prompt: undefined,
      };

      // Fetch the full diff
      console.log(`[${repo}] Fetching diff from GitHub...`);
      const fullDiff = await fetchComparisonDiff(evalEntry);

      // Generate the prompt
      console.log(`[${repo}] Generating prompt from diff...`);
      const prompt = await generateSinglePrompt(evalEntry, fullDiff);

      // Update the entry
      entry.prompt = prompt;
      updated = true;

      console.log(`[${repo}] ✓ Prompt generated successfully`);
      console.log(`[${repo}] Preview: ${prompt.slice(0, 100)}...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${repo}] ✗ Failed to generate prompt: ${message}`);

      if (!options.all) {
        process.exitCode = 1;
        return;
      }
    }
  }

  if (updated) {
    console.log("\nWriting updated dataset.yaml...");

    // Convert back to YAML and write
    const updatedYaml = stringifyYaml(rawData, {
      lineWidth: 0, // Disable line wrapping
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
    });

    writeFileSync(DATASET_PATH, updatedYaml, "utf-8");
    console.log("✓ dataset.yaml updated successfully");
  } else {
    console.log("\nNo updates needed.");
  }
}

main()
  .catch((error) => {
    console.error("Script failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.exitCode === undefined || process.exitCode === 0) {
      process.exit(0);
    } else {
      process.exit(process.exitCode);
    }
  });
