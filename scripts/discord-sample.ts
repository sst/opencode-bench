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
  rawModelId: string;
  agentId: string;
  final: number;
  jobUrl?: string;
  rows: ScoreRow[];
};

type EvalSummary = {
  eval: string;
  models: ModelSummary[];
};

type ModelAverage = {
  id: string;
  score: number;
};

const QUICKCHART_BASE_URL = "https://quickchart.io/chart";
const colorHex = "0c0c0e";
const embedColor = parseInt(colorHex, 16);

type DiscordField = {
  name: string;
  value: string;
  inline: boolean;
};

type DiscordEmbed = {
  title: string;
  color: number;
  fields: DiscordField[];
  image?: { url: string };
};

type DiscordPayload = {
  username: string;
  avatar_url: string;
  content?: string;
  embeds?: DiscordEmbed[];
};

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
      jobUrl:
        "https://github.com/sst/opencode-bench/actions/runs/1234567890/job/111",
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
      jobUrl:
        "https://github.com/sst/opencode-bench/actions/runs/1234567890/job/222",
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
      const agentName = (run.agent ?? "").trim();
      const prefixedId = `${agentName}:${modelId}`;

      summaries.push({
        id: prefixedId,
        rawModelId: modelId,
        agentId: agentName.length > 0 ? agentName : run.agent,
        final: run.summary.finalScore,
        jobUrl: run.jobUrl,
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

/**
 * Builds a shareable QuickChart radar chart URL for a model’s per-metric scores.
 * Currently unused in the Discord webhook, but retained for future scorecard embeds.
 */
function buildRadarChartUrl(
  model: ModelSummary,
  evalName: string,
): string | undefined {
  if (model.rows.length === 0) {
    return undefined;
  }

  const labels = model.rows.map((row) => row.name);
  const values = model.rows.map((row) => Number(row.average.toFixed(3)));

  if (labels.length > 0) {
    labels.push(labels[0]);
    values.push(values[0]);
  }

  const config = {
    type: "radar",
    data: {
      labels,
      datasets: [
        {
          label: model.id,
          data: values,
          backgroundColor: "rgba(188,187,187,0.3)",
          borderColor: "#1F1E1E",
          borderWidth: 2,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `${evalName} • ${model.id}`,
        },
      },
      scale: {
        ticks: {
          beginAtZero: true,
          min: 0,
          max: 1,
          stepSize: 0.2,
        },
      },
      elements: {
        line: { borderJoinStyle: "round" },
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(config));

  return `${QUICKCHART_BASE_URL}?c=${encodedConfig}&w=600&h=500&bkg=white`;
}

function computeAverageScore(model: ModelSummary): number {
  if (model.rows.length === 0) {
    return 0;
  }

  const total = model.rows.reduce((sum, score) => sum + score.average, 0);

  return total / model.rows.length;
}

function buildAverageChartUrl(
  evalName: string,
  models: ModelSummary[],
): string | undefined {
  if (models.length === 0) {
    return undefined;
  }

  const sorted = models
    .map((model) => ({
      id: model.id,
      score: Number(model.final.toFixed(3)),
    }))
    .sort((a, b) => b.score - a.score);

  const labels = sorted.map((entry) => entry.id);
  const averages = sorted.map((entry) => entry.score);

  const fillColor = "rgba(31,30,29,0.94)";
  const strokeColor = "rgba(31,30,29,1)";
  const backgroundColor = Array(sorted.length).fill(fillColor);
  const borderColor = Array(sorted.length).fill(strokeColor);

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Average Score",
          data: averages,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `Average Performance by Model (${evalName})`,
        },
      },
      scales: {
        yAxes: [
          {
            ticks: {
              beginAtZero: true,
              min: 0,
              max: 1,
            },
          },
        ],
        xAxes: [
          {
            ticks: { autoSkip: false },
          },
        ],
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(config));

  return `${QUICKCHART_BASE_URL}?c=${encodedConfig}&w=700&h=400&bkg=white`;
}

function buildOverallChartUrl(
  evalSummaries: EvalSummary[],
): string | undefined {
  const aggregates = new Map<string, { total: number; count: number }>();

  evalSummaries.forEach((summary) => {
    summary.models.forEach((model) => {
      const entry = aggregates.get(model.id) ?? { total: 0, count: 0 };
      entry.total += model.final;
      entry.count += 1;
      aggregates.set(model.id, entry);
    });
  });

  if (aggregates.size === 0) {
    return undefined;
  }

  const averages: ModelAverage[] = Array.from(aggregates.entries()).map(
    ([id, { total, count }]) => ({
      id,
      score: Number((total / count).toFixed(3)),
    }),
  );

  averages.sort((a, b) => b.score - a.score);

  const labels = averages.map((entry) => entry.id);
  const data = averages.map((entry) => entry.score);
  const fillColor = "rgba(31,30,29,0.94)";
  const strokeColor = "rgba(31,30,29,1)";
  const backgroundColor = Array(data.length).fill(fillColor);
  const borderColor = Array(data.length).fill(strokeColor);

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Average Score",
          data,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: "Average Performance by Model (All Evaluations)",
        },
      },
      scales: {
        yAxes: [
          {
            ticks: {
              beginAtZero: true,
              min: 0,
              max: 1,
            },
          },
        ],
        xAxes: [
          {
            ticks: { autoSkip: false },
          },
        ],
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(config));

  return `${QUICKCHART_BASE_URL}?c=${encodedConfig}&w=700&h=400&bkg=white`;
}

function buildPayloads(evalSummaries: EvalSummary[]): DiscordPayload[] {
  const contentLink = resolveContentLink();
  const overallChartUrl = buildOverallChartUrl(evalSummaries);

  const embeds = evalSummaries.map((summary) => {
    const fields = summary.models.map((model) => {
      const finalScore = model.final.toFixed(3);
      const decoratedValue =
        model.jobUrl !== undefined
          ? `${finalScore} [Link](${model.jobUrl})`
          : finalScore;

      return {
        name: model.id,
        value: decoratedValue,
        inline: false,
      };
    });

    const averageChartUrl = buildAverageChartUrl(summary.eval, summary.models);

    return {
      title: summary.eval,
      color: embedColor,
      fields,
      ...(averageChartUrl
        ? {
            image: { url: averageChartUrl },
          }
        : {}),
    };
  });

  const contentLines: string[] = [];
  if (contentLink) {
    contentLines.push(contentLink);
  }
  if (overallChartUrl) {
    contentLines.push(`[Scoreboard](${overallChartUrl})`);
  }

  const content = contentLines.length > 0 ? contentLines.join("\n") : undefined;

  const basePayload: Pick<DiscordPayload, "username" | "avatar_url"> = {
    username: "opencode",
    avatar_url:
      "https://pbs.twimg.com/profile_images/1973794620233433088/nBn75BTm_400x400.png",
  };

  if (embeds.length === 0) {
    return [
      {
        ...basePayload,
        ...(content
          ? { content }
          : { content: "No evaluation results available." }),
      },
    ];
  }

  return embeds.map((embed, index) => ({
    ...basePayload,
    embeds: [embed],
    ...(index === 0 && content ? { content } : {}),
  }));
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
async function sendWebhook(
  webhookUrl: string,
  payload: unknown,
  partIndex: number,
  totalParts: number,
): Promise<void> {
  const partLabel = `part ${partIndex}/${totalParts}`;
  console.log(`Sending Discord webhook (${partLabel})...`);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Discord webhook request failed (${partLabel}): ${response.status} ${response.statusText}`,
    );
    if (errorText) {
      console.error(`Response body: ${errorText}`);
    }
    throw new Error(
      `Discord webhook request failed (${response.status} ${response.statusText})`,
    );
  }

  console.log(`Discord webhook delivered (${partLabel}).`);
}

async function main(): Promise<void> {
  const exportData = loadExport();
  const evalSummaries = toEvalSummaries(exportData);
  const payloads = buildPayloads(evalSummaries);

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
  payloads.forEach((payload, index) => {
    console.log(`--- Payload ${index + 1}/${payloads.length} ---`);
    console.log(JSON.stringify(payload, null, 2));
  });

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL not set; skipping Discord webhook send.");
    return;
  }

  try {
    for (const [index, payload] of payloads.entries()) {
      await sendWebhook(webhookUrl, payload, index + 1, payloads.length);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to deliver Discord webhook: ${message}`);
    process.exitCode = 1;
  }
}

await main();
