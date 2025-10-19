#!/usr/bin/env bun
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import type { BenchmarkExport } from "~/types/export.js";

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

const jsonFiles = collectJsonFiles(inputRoot);
if (jsonFiles.length === 0) {
  process.stderr.write(`No JSON benchmark exports found in ${inputRoot}.\n`);
  process.exit(1);
}

let exportVersion: BenchmarkExport["version"] | undefined;
const mergedRuns: BenchmarkExport["runs"] = [];

for (const filePath of jsonFiles) {
  const raw = readFileSync(filePath, "utf8");
  const parsed: BenchmarkExport = JSON.parse(raw);

  if (typeof parsed.version !== "number") {
    process.stderr.write(`Invalid export version in ${filePath}.\n`);
    process.exit(1);
  }

  if (exportVersion === undefined) {
    exportVersion = parsed.version;
  } else if (parsed.version !== exportVersion) {
    process.stderr.write(
      `Mismatched export versions detected (expected ${exportVersion}, found ${parsed.version}).\n`,
    );
    process.exit(1);
  }

  mergedRuns.push(...parsed.runs);
}

const mergedExport: BenchmarkExport = {
  version: exportVersion ?? 1,
  runs: mergedRuns,
};

writeFileSync(outputPath, JSON.stringify(mergedExport, null, 2));
