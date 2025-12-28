#!/usr/bin/env bun
import { readFile } from "node:fs/promises";

const agent = process.env.AGENT!;
const model = process.env.MODEL!;
const tasksSummaryPath = process.env.TASKS_SUMMARY_PATH!;

const summary = await readFile(tasksSummaryPath, "utf8");

await fetch("https://opencode.ai/bench/submission", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    agent,
    model,
    result: summary,
  }),
});

process.exit();
