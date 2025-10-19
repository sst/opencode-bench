#!/usr/bin/env bun
/**
 * Discord notifier for benchmark results.
 *
 * Run with:
 *   bun run scripts/discord-sample.ts [path/to/export.json)]
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

type ModelSummary = {
  id: string;
  final: number;
  rows: ScoreRow[];
};

type EvalSummary = {
  eval: string;
  models: ModelSummary[];
};

const RADAR_CHART_BASE_URL = "https://image-charts.com/chart";
const colorHex = "0c0c0e";
const embedColor = parseInt(colorHex, 16);

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
      model: "opencode/claude-sonnet-4-5",
      summary: {
        finalScore: 0.902,
        baseScore: 0.905,
        variancePenalty: 0.003,
      },
      scores: [
        {
          assignment: {
            name: "api-signature",
            weight: 0.4,
            args: undefined,
          },
          averageScore: 0.905,
          normalizedWeight: 0.4,
          variance: 0.03,
          judges: [],
        },
        {
          assignment: {
            name: "logic-equivalence",
            weight: 0.37,
            args: undefined,
          },
          averageScore: 0.892,
          normalizedWeight: 0.37,
          variance: 0.025,
          judges: [],
        },
        {
          assignment: {
            name: "checks",
            weight: 0.23,
            args: undefined,
          },
          averageScore: 0.98,
          normalizedWeight: 0.23,
          variance: 0.0,
          judges: [],
        },
      ],
    },
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
            name: "api-signature",
            weight: 0.4,
            args: undefined,
          },
          averageScore: 0.903,
          normalizedWeight: 0.4,
          variance: 0.041,
          judges: [],
        },
        {
          assignment: {
            name: "logic-equivalence",
            weight: 0.37,
            args: undefined,
          },
          averageScore: 0.888,
          normalizedWeight: 0.37,
          variance: 0.03,
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
  const evalMap = new Map<string, ModelSummary[]>();

  exportData.runs.forEach((run) => {
    const modelIds = Array.isArray(run.model) ? run.model : [run.model];
    const modelRows = run.scores.map((score) => ({
      name: score.assignment.name,
      weight: score.assignment.weight,
      normalizedWeight: score.normalizedWeight,
      average: score.averageScore,
      variance: score.variance,
    }));

    const summaries = evalMap.get(run.evaluation.repo) ?? [];

    modelIds.forEach((modelId) => {
      summaries.push({
        id: modelId,
        final: run.summary.finalScore,
        rows: modelRows,
      });
    });

    evalMap.set(run.evaluation.repo, summaries);
  });

  return Array.from(evalMap.entries()).map(([repo, models]) => ({
    eval: repo,
    models,
  }));
}

function buildRadarChartUrl(
  model: ModelSummary,
  evalName: string,
): string | undefined {
  if (model.rows.length === 0) {
    return undefined;
  }

  const values = model.rows.map((row) => row.average);
  const labels = model.rows.map((row) => row.name);

  // close the radar polygon by repeating the first value/label
  values.push(values[0]);
  labels.push(labels[0]);

  const params = new URLSearchParams({
    chs: "600x500",
    cht: "r",
    chd: `t:${values.map((value) => value.toFixed(3)).join(",")}`,
    chl: labels.join("|"),
    chco: "1F1E1E,F8FAC780",
    chf: "bg,s,FDFCFC|c,lg,45,FDFCFC00,0.0,FAFCE930,1.0",
    chtt: `${evalName} • ${model.id}`,
    chts: "1F1E1E,18",
    chxt: "r",
    chxr: "0,0,1,0.2",
    chxs: "0,646262,12,0,l",
    chm: "N*f2*,1F1E1E,0,-1,12",
  });

  return `${RADAR_CHART_BASE_URL}?${params.toString()}`;
}

function buildPayload(evalSummaries: EvalSummary[]) {
  const contentLink = resolveContentLink();
  const embeds = evalSummaries.map((summary) => {
    const fields = summary.models.map((model) => {
      const lines = [
        `Score: ${model.final.toFixed(3)}`,
        ...model.rows.map((row) => `${row.name}: ${row.average.toFixed(3)}`),
      ];

      const radarUrl = buildRadarChartUrl(model, summary.eval);

      return {
        name: radarUrl ? `[${model.id}](${radarUrl})` : model.id,
        value: lines.join("\n"),
        inline: false,
      };
    });

    return {
      title: summary.eval,
      color: embedColor,
      fields,
    };
  });

  const content = contentLink ?? undefined;

  return {
    username: "opencode",
    avatar_url:
      "https://pbs.twimg.com/profile_images/1973794620233433088/nBn75BTm_400x400.png",
    content,
    embeds,
  };
}

function resolveContentLink(): string | undefined {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    return undefined;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const eventName = process.env.GITHUB_EVENT_NAME;

  if (eventName === "pull_request") {
    const ref = process.env.GITHUB_REF ?? "";
    const match = ref.match(/^refs\/pull\/(\d+)\//);
    if (match) {
      const prNumber = match[1];
      return `${serverUrl}/${repository}/pull/${prNumber}`;
    }
  }

  const sha = process.env.GITHUB_SHA;
  if (sha) {
    return `${serverUrl}/${repository}/commit/${sha}`;
  }

  return undefined;
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
    summary.models.forEach((model) => {
      console.log(`Model: ${model.id}`);
      console.log(`  Score: ${model.final.toFixed(3)}`);
      model.rows.forEach((row) => {
        console.log(`    - ${row.name}: ${row.average.toFixed(3)}`);
      });
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
