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

const QUICKCHART_BASE_URL = "https://quickchart.io/chart";
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

  const labels = model.rows.map((row) => row.name);
  const values = model.rows.map((row) => Number(row.average.toFixed(3)));

  if (labels.length > 0) {
    labels.push(labels[0]);
    values.push(values[0]);
  }

  const config = {
    type: "radar",
    backgroundColor: "#FDFBF9",
    data: {
      labels,
      datasets: [
        {
          label: model.id,
          data: values,
          backgroundColor: "rgba(188, 187, 187, 0.3)",
          borderColor: "#1F1E1E",
          borderWidth: 2,
          pointBackgroundColor: "rgba(31, 30, 29, 0.9)",
          pointBorderColor: "#FDFBF9",
          pointHoverRadius: 5,
          lineTension: 0.1,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      layout: {
        padding: { top: 24, right: 32, bottom: 16, left: 32 },
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `${evalName} • ${model.id}`,
          color: "hsl(0, 5%, 12%)",
          font: {
            size: 18,
            family: "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
            weight: "500",
          },
        },
        datalabels: false,
      },
      scale: {
        ticks: {
          beginAtZero: true,
          min: 0,
          max: 1,
          stepSize: 0.2,
          showLabelBackdrop: false,
          fontColor: "hsl(0, 1%, 39%)",
          fontFamily:
            "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
        },
        gridLines: {
          color: "rgba(176, 176, 176, 0.35)",
        },
        angleLines: {
          color: "rgba(143, 139, 139, 0.3)",
        },
        pointLabels: {
          fontColor: "hsl(0, 1%, 39%)",
          fontFamily:
            "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
        },
      },
      elements: {
        line: {
          borderJoinStyle: "round",
        },
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(config));

  return `${QUICKCHART_BASE_URL}?c=${encodedConfig}&v=2&w=600&h=500`;
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

  const labels = models.map((model) => model.id);
  const averages = models.map((model) => Number(model.final.toFixed(3)));

  const baseBackgroundColors = [
    "rgba(31, 30, 29, 0.94)",
    "rgba(188, 187, 187, 0.9)",
    "rgba(248, 250, 199, 0.85)",
    "rgba(100, 98, 98, 0.9)",
  ];
  const baseHoverColors = [
    "rgba(31, 30, 29, 1)",
    "rgba(188, 187, 187, 1)",
    "rgba(248, 250, 199, 1)",
    "rgba(100, 98, 98, 1)",
  ];
  const baseBorderColors = [
    "rgba(31, 30, 29, 1)",
    "rgba(143, 139, 139, 1)",
    "rgba(188, 187, 187, 1)",
    "rgba(100, 98, 98, 1)",
  ];

  const backgroundColor = models.map(
    (_, index) => baseBackgroundColors[index % baseBackgroundColors.length],
  );
  const hoverBackgroundColor = models.map(
    (_, index) => baseHoverColors[index % baseHoverColors.length],
  );
  const borderColor = models.map(
    (_, index) => baseBorderColors[index % baseBorderColors.length],
  );

  const config = {
    type: "bar",
    backgroundColor: "#FDFBF9",
    data: {
      labels,
      datasets: [
        {
          label: "Average Score",
          data: averages,
          backgroundColor,
          hoverBackgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
          barPercentage: 0.5,
          categoryPercentage: 0.6,
          maxBarThickness: 48,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      layout: {
        padding: { top: 32, right: 36, bottom: 28, left: 36 },
      },
      title: {
        display: true,
        text: `Average Performance by Model (${evalName})`,
        fontFamily: "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
        fontColor: "hsl(0, 5%, 12%)",
        fontSize: 18,
        fontStyle: "normal",
        padding: 24,
      },
      legend: {
        display: false,
      },
      scales: {
        yAxes: [
          {
            ticks: {
              beginAtZero: true,
              min: 0,
              max: 1,
              stepSize: 0.2,
              fontColor: "hsl(0, 1%, 39%)",
              fontFamily:
                "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
              padding: 6,
            },
            gridLines: {
              color: "rgba(176, 176, 176, 0.35)",
              zeroLineColor: "rgba(143, 139, 139, 0.55)",
              drawTicks: false,
            },
            scaleLabel: {
              display: true,
              labelString: "Average Score",
              fontColor: "hsl(0, 5%, 12%)",
              fontFamily:
                "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
              fontStyle: "600",
            },
          },
        ],
        xAxes: [
          {
            ticks: {
              autoSkip: false,
              fontColor: "hsl(0, 5%, 12%)",
              fontFamily:
                "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
              maxRotation: 0,
              minRotation: 0,
              padding: 12,
            },
            gridLines: {
              display: false,
              drawBorder: false,
            },
          },
        ],
      },
      tooltips: {
        backgroundColor: "rgba(31, 28, 28, 0.92)",
        titleFontFamily:
          "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
        titleFontColor: "#FDFBF9",
        bodyFontFamily:
          "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace",
        bodyFontColor: "#FDFBF9",
        borderColor: "rgba(143, 139, 139, 0.4)",
        borderWidth: 1,
        xPadding: 14,
        yPadding: 12,
        caretSize: 6,
        caretPadding: 8,
      },
      plugins: {
        datalabels: { display: false },
      },
      elements: {
        rectangle: { borderSkipped: "bottom" },
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(config));

  return `${QUICKCHART_BASE_URL}?c=${encodedConfig}&v=2&w=700&h=400`;
}

function buildPayload(evalSummaries: EvalSummary[]) {
  const contentLink = resolveContentLink();
  const embeds = evalSummaries.map((summary) => {
    const fields = summary.models.map((model) => {
      const finalScore = model.final.toFixed(3);
      const radarUrl = buildRadarChartUrl(model, summary.eval);

      return {
        name: model.id,
        value: radarUrl ? `[${finalScore}](${radarUrl})` : finalScore,
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
