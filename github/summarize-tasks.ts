#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { Summarizer } from "../src/summarizer.js";
import { sanitizeFilename } from "../src/util/fs.js";

const runsSummaryPaths = process.env.RUNS_SUMMARY_PATHS!;
const tasksSummaryPath = sanitizeFilename(process.env.TASKS_SUMMARY_PATH!);

const runsSummaries = await Promise.all(
  runsSummaryPaths.split(",").map(async (runsSummaryPath) => {
    const runsSummary = await readFile(
      sanitizeFilename(runsSummaryPath),
      "utf8",
    );
    return JSON.parse(runsSummary);
  }),
);

const summary = await Summarizer.summarizeTasks(runsSummaries);

await writeFile(tasksSummaryPath, JSON.stringify(summary));
