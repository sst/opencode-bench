#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { Summarizer } from "../src/summarizer.js";
import { sanitizeFilename } from "../src/util/fs.js";

const resultPaths = process.env.RESULT_PATHS!;
const runsSummaryPath = sanitizeFilename(process.env.RUNS_SUMMARY_PATH!);

const results = await Promise.all(
  resultPaths.split(",").map(async (resultPath) => {
    const result = await readFile(sanitizeFilename(resultPath), "utf8");
    return JSON.parse(result);
  }),
);

const summary = await Summarizer.summarizeRuns(results);

await writeFile(runsSummaryPath, JSON.stringify(summary));

process.exit();
