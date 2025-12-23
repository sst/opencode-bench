#!/usr/bin/env bun
/**
 * Agent Analysis Script
 *
 * Compares agent/model performance for one or more benchmark exports.
 * Accepts either a single benchmark run or a merged export containing
 * multiple runs of the same evaluation across different agents/models.
 *
 * Usage:
 *   bun run scripts/analysis.ts path/to/benchmark.json
 *   bun run scripts/analysis.ts path/to/merged.json
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import { generateText } from "ai";
import type { EvaluationRunExport } from "~/types/export.js";
import { getZenLanguageModel } from "~/src/zenModels.js";

export const AGENT_ANALYSIS_PROMPT = `You are an expert analyst reviewing how different agents and models perform on the same benchmark evaluation.

Your task is to analyze the benchmark data and identify:
1. **Systematic patterns**: Are certain agents or models consistently leading or lagging?
2. **Performance gaps**: Where are the largest score deltas, and what might explain them?
3. **Agent tendencies**: Do some runs prioritize certain behaviors (e.g., safety, completeness) based on their summaries?
4. **Notable insights**: Highlight interesting contrasts between the strongest and weakest runs.
5. **Recommendations**: Suggest concrete adjustments or experiments to improve future runs.

Focus on concrete observations from the data provided. Look for patterns such as:
- Consistent scoring differences between specific agents or models
- Summaries that reveal different optimization strategies or failure modes
- Runs that score well overall but exhibit weaknesses in their own write-ups

Provide a concise, insightful analysis that helps developers understand agent behavior and improve the evaluation system.`;

const analyzerModelId = "opencode/claude-sonnet-4-5";

function buildDynamicContext(runs: EvaluationRunExport[]): string {
  const repo = runs[0].evaluation.repo;
  const parts: string[] = [];

  parts.push(`# Evaluation
- Repository: ${repo}
- Total runs: ${runs.length}
`);

  parts.push("# Run Scoreboard");
  runs.forEach((run, index) => {
    parts.push(
      `${index + 1}. ${run.agent} (${
        run.model
      }) — final ${run.finalScore.toFixed(3)}, base ${run.baseScore.toFixed(
        3,
      )}, penalty ${run.variancePenalty.toFixed(3)}`,
    );
    if (run.summary?.trim()) {
      parts.push(`   Summary: ${run.summary.trim()}`);
    }
  });
  parts.push("");

  return parts.join("\n");
}

function formatFallbackSummary(runs: EvaluationRunExport[]): string {
  const repo = runs[0].evaluation.repo;
  const lines: string[] = [];

  lines.push(`Evaluation: ${repo}`);
  lines.push("");
  lines.push("Runs (best to worst):");

  runs.forEach((run, index) => {
    lines.push(
      `${index + 1}. ${run.agent} (${
        run.model
      }) – final ${run.finalScore.toFixed(3)}, base ${run.baseScore.toFixed(
        3,
      )}, penalty ${run.variancePenalty.toFixed(3)}`,
    );

    if (run.summary?.trim()) {
      lines.push(`   summary: ${run.summary.replace(/\s+/g, " ").trim()}`);
    }
  });

  if (runs.length > 1) {
    const leader = runs[0];
    const trailer = runs[runs.length - 1];
    const gap = leader.finalScore - trailer.finalScore;
    lines.push("");
    lines.push(`Score gap (top vs bottom): ${gap.toFixed(3)}`);
  }

  return lines.join("\n").trimEnd();
}

async function generateAnalysis(runs: EvaluationRunExport[]): Promise<string> {
  const context = buildDynamicContext(runs);

  const { text } = await generateText({
    model: getZenLanguageModel(analyzerModelId),
    system: AGENT_ANALYSIS_PROMPT,
    prompt: context,
    temperature: 0.3,
  });
  return text.trim();
}

function usage(): void {
  console.error("Usage: bun run scripts/analysis.ts <benchmark-file.json>");
  console.error("");
  console.error(
    "Generates an AI-powered comparison of agent/model performance.",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const filePath = args[0];
  let runs: EvaluationRunExport[];

  try {
    const fileContent = readFileSync(filePath, "utf-8");
    runs = JSON.parse(fileContent) as EvaluationRunExport[];
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    process.exit(1);
  }

  if (runs.length === 0) {
    console.error("No evaluation runs found in the provided file.");
    process.exit(1);
  }

  runs.sort((a, b) => b.finalScore - a.finalScore);

  const output = await generateAnalysis(runs);
  process.stdout.write(`${output.trimEnd()}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
