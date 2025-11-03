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
    process.stderr.write(
      `Error: Expected evaluation run object in ${filePath}.\n`,
    );
    process.exit(1);
  }

  mergedRuns.push(parsed as EvaluationRunExport);
}

writeFileSync(outputPath, JSON.stringify(mergedRuns, null, 2));
