#!/usr/bin/env bun
/**
 * Discord notifier for benchmark results.
 *
 * Run with:
 *   bun run scripts/discord-sample.ts [path/to/export.json]
 * If DISCORD_WEBHOOK_URL is set, the payload will be sent automatically.
 */

import { readFileSync } from "node:fs";

import type { BenchmarkExport } from "~/types/export.js";

type ScoreRow = {
  name: string;
  weight: number;
  normalizedWeight: number;
  average: number;
  variance: number;
};

type EvalSummary = {
  eval: string;
  model: string;
  final: number;
  rows: ScoreRow[];
};

const colorHex = "0c0c0e";
const embedColor = parseInt(colorHex, 16);

const formatRawWeight = (value: number): string => {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return Number(value.toPrecision(6)).toString();
};

const formatNormalizedWeight = (value: number): string =>
  Number(value.toFixed(3)).toString();

const sampleExport: BenchmarkExport = {
  version: 1,
  runs: [
    {
      agent: "opencode",
      evaluation: {
        repo: "prismicio-community/course-fizzi-next",
        from: "e90e3f4e07119d60e8822d4f474f6dfa5afe589f",
        to: "2760114f2647ebec8f63e0ecc2dc87a8cd4096ac",
      },
      model: "opencode/gpt-5-codex",
      summary: {
        finalScore: 0.898,
        baseScore: 0.903,
        variancePenalty: 0.004,
      },
      scores: [
        {
          assignment: {
            name: "semantic-similarity",
            weight: 0.77,
            args: undefined,
          },
          averageScore: 0.903,
          normalizedWeight: 0.77,
          variance: 0.041,
          judges: [],
        },
        {
          assignment: {
            name: "checks",
            weight: 0.23,
            args: undefined,
          },
          averageScore: 0.967,
          normalizedWeight: 0.23,
          variance: 0.0,
          judges: [],
        },
      ],
    },
  ],
};

function loadExport(): BenchmarkExport {
  const inputPath = process.argv[2];
  if (!inputPath) {
    return sampleExport;
  }

  const raw = readFileSync(inputPath, "utf8");
  const parsed: BenchmarkExport = JSON.parse(raw);
  if (parsed.version !== 1) {
    throw new Error(`Unsupported export version: ${parsed.version}`);
  }

  return parsed;
}

function toEvalSummaries(exportData: BenchmarkExport): EvalSummary[] {
  return exportData.runs.map((run) => ({
    eval: run.evaluation.repo,
    model: run.model,
    final: run.summary.finalScore,
    rows: run.scores.map((score) => ({
      name: score.assignment.name,
      weight: score.assignment.weight,
      normalizedWeight: score.normalizedWeight,
      average: score.averageScore,
      variance: score.variance,
    })),
  }));
}

function buildPayload(evalSummaries: EvalSummary[]) {
  const embeds = evalSummaries.map((summary) => ({
    title: `[${summary.eval}](https://github.com/${summary.eval})`,
    description: [
      `**${summary.final.toFixed(3)}**`,
      `\`\`\`${summary.model}\`\`\``,
    ].join("\n"),
    color: embedColor,
    fields: summary.rows.map((row) => ({
      name: row.name,
      value: [
        `• Weight: ${formatRawWeight(row.weight)}`,
        `• Normalized Weight: ${formatNormalizedWeight(row.normalizedWeight)}`,
        `• Average: ${row.average.toFixed(3)}`,
        `• Variance: ${row.variance.toFixed(3)}`,
      ].join("\n"),
      inline: false,
    })),
  }));

  const content =
    process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
      ? `[${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_JOB ?? "job"}](https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})`
      : undefined;

  return {
    username: "opencode",
    avatar_url: "https://pbs.twimg.com/profile_images/1973794620233433088/nBn75BTm_400x400.png",
    content,
    embeds,
  };
}

async function sendWebhook(payload: unknown): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL not set; skipping Discord webhook send.");
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Discord webhook request failed (${response.status} ${response.statusText}): ${errorText}`,
    );
  }
}

async function main(): Promise<void> {
  const exportData = loadExport();
  const evalSummaries = toEvalSummaries(exportData);
  const payload = buildPayload(evalSummaries);

  console.log("===== Plain-text preview =====\n");
  for (const summary of evalSummaries) {
    console.log(`Eval: ${summary.eval}`);
    console.log(`Score: ${summary.final.toFixed(3)}`);
    console.log(`Model: ${summary.model}`);
    summary.rows.forEach((row) => {
      console.log(
        `  - ${row.name}: weight=${row.weight.toFixed(2)}, normalized=${row.normalizedWeight.toFixed(
          2,
        )}, average=${row.average.toFixed(3)}, variance=${row.variance.toFixed(3)}`,
      );
    });
    console.log("");
  }

  console.log("===== Webhook payload JSON =====\n");
  console.log(JSON.stringify(payload, null, 2));

  try {
    await sendWebhook(payload);
    console.log("Discord webhook delivered.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to deliver Discord webhook: ${message}`);
    process.exitCode = 1;
  }
}

await main();
