#!/usr/bin/env bun
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import type { EvaluationRunExport } from "~/types/export.js";

function collectJsonFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }

  return files;
}

const inputRoot = resolve(process.argv[2] ?? ".");
const outputPath = resolve(process.argv[3] ?? "benchmark.json");
const debugEnabled = true;

const jsonFiles = collectJsonFiles(inputRoot);
if (jsonFiles.length === 0) {
  process.stderr.write(`No JSON benchmark exports found in ${inputRoot}.\n`);
  process.exit(1);
}

const mergedRuns: EvaluationRunExport[] = [];

for (const filePath of jsonFiles) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || !("evaluation" in parsed)) {
    process.stderr.write(`Skipping non-evaluation export JSON: ${filePath}\n`);

    if (debugEnabled) {
      const valueType = Array.isArray(parsed) ? "array" : typeof parsed;
      const keys =
        parsed && typeof parsed === "object"
          ? Object.keys(parsed as Record<string, unknown>).slice(0, 10)
          : [];
      process.stderr.write(
        `  type=${valueType} keys=${keys.length ? keys.join(",") : "<none>"}\n`,
      );
      const preview = raw.slice(0, 500).replace(/\s+/g, " ").trim();
      process.stderr.write(`  preview=${preview}\n`);
    }

    continue;
  }

  mergedRuns.push(parsed as EvaluationRunExport);
}

if (mergedRuns.length === 0) {
  process.stderr.write(
    `No evaluation runs found in ${inputRoot}; nothing to merge.\n`,
  );
  process.exit(1);
}

if (debugEnabled) {
  process.stderr.write(
    `Merged ${mergedRuns.length} evaluation run(s) into ${outputPath}\n`,
  );
}

writeFileSync(outputPath, JSON.stringify(mergedRuns, null, 2));
