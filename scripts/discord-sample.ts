#!/usr/bin/env bun
/**
 * Discord notifier for benchmark results.
 *
 * Run with:
 *   bun run scripts/discord-sample.ts [path/to/export.json)]
 * If DISCORD_WEBHOOK_URL is set, the payload will be sent automatically.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import type { Episode, EvaluationRunExport } from "~/types/export.js";
import { buildRadarChartUrl, buildBarChartUrl } from "~/lib/charts.js";

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
  jobUrl: string;
  rows: ScoreRow[];
  episodes: Episode[];
};

type EvalSummary = {
  eval: string;
  label: string;
  models: ModelSummary[];
};

type ModelAverage = {
  id: string;
  score: number;
};

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

type AnalysisLinkEntry = {
  eval: string;
  url: string;
};

const cloneScores = (
  scores: EvaluationRunExport["scores"],
  averageShift: number,
  varianceShift = 0,
): EvaluationRunExport["scores"] =>
  scores.map((score) => {
    const shiftedAverage = Number(
      Math.min(1, Math.max(0, score.averageScore + averageShift)).toFixed(3),
    );
    const shiftedVariance = Number(
      Math.max(0, score.variance + varianceShift).toFixed(3),
    );

    return {
      assignment: { ...score.assignment },
      averageScore: shiftedAverage,
      normalizedWeight: score.normalizedWeight,
      variance: shiftedVariance,
      judges: score.judges.map((judge) => ({ ...judge })),
    };
  });

const claudeScores: EvaluationRunExport["scores"] = [
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
];

const claudeEpisodes: Episode[] = [
  {
    finalScore: 0.909,
    baseScore: 0.912,
    variancePenalty: 0.003,
    scores: cloneScores(claudeScores, 0.002, -0.005),
    usage: { input: 50000, output: 10000 },
  },
  {
    finalScore: 0.901,
    baseScore: 0.905,
    variancePenalty: 0.004,
    scores: cloneScores(claudeScores, 0, 0),
    usage: { input: 51000, output: 10500 },
  },
  {
    finalScore: 0.896,
    baseScore: 0.902,
    variancePenalty: 0.006,
    scores: cloneScores(claudeScores, -0.002, 0.004),
    usage: { input: 49000, output: 9800 },
  },
];

const gptScores: EvaluationRunExport["scores"] = [
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
];

const gptEpisodes: Episode[] = [
  {
    finalScore: 0.903,
    baseScore: 0.907,
    variancePenalty: 0.004,
    scores: cloneScores(gptScores, 0.003, -0.006),
    usage: { input: 48000, output: 9500 },
  },
  {
    finalScore: 0.894,
    baseScore: 0.898,
    variancePenalty: 0.004,
    scores: cloneScores(gptScores, -0.002, 0.002),
    usage: { input: 49000, output: 9800 },
  },
  {
    finalScore: 0.892,
    baseScore: 0.897,
    variancePenalty: 0.005,
    scores: cloneScores(gptScores, -0.003, 0.004),
    usage: { input: 47500, output: 9400 },
  },
];

const sampleExport: EvaluationRunExport[] = [
  {
    agent: "opencode",
    evaluation: {
      identifier: "prismicio-community/course-fizzi-next@e90e3f4..2760114",
      repo: "prismicio-community/course-fizzi-next",
      from: "e90e3f4e07119d60e8822d4f474f6dfa5afe589f",
      to: "2760114f2647ebec8f63e0ecc2dc87a8cd4096ac",
    },
    model: "opencode/claude-sonnet-4-5",
    jobUrl:
      "https://github.com/sst/opencode-bench/actions/runs/1234567890/job/111",
    finalScore: 0.902,
    baseScore: 0.905,
    variancePenalty: 0.003,
    scores: claudeScores,
    episodes: claudeEpisodes,
    usage: { input: 50000, output: 10100 },
    summary: "",
  },
  {
    agent: "opencode",
    evaluation: {
      identifier: "prismicio-community/course-fizzi-next@e90e3f4..2760114",
      repo: "prismicio-community/course-fizzi-next",
      from: "e90e3f4e07119d60e8822d4f474f6dfa5afe589f",
      to: "2760114f2647ebec8f63e0ecc2dc87a8cd4096ac",
    },
    model: "opencode/gpt-5-codex",
    jobUrl:
      "https://github.com/sst/opencode-bench/actions/runs/1234567890/job/222",
    finalScore: 0.898,
    baseScore: 0.903,
    variancePenalty: 0.004,
    scores: gptScores,
    episodes: gptEpisodes,
    usage: { input: 48167, output: 9633 },
    summary: "",
  },
];

function loadExport(): EvaluationRunExport[] {
  const inputPath = process.argv[2];
  if (!inputPath) {
    return sampleExport;
  }

  const raw = readFileSync(inputPath, "utf8");

  return JSON.parse(raw);
}

function toEvalSummaries(exportData: EvaluationRunExport[]): EvalSummary[] {
  const evalMap = new Map<string, ModelSummary[]>();
  const labelMap = new Map<string, string>();

  exportData.forEach((run, index) => {
    assert(
      run !== null && typeof run === "object",
      `Invalid evaluation entry at index ${index}`,
    );

    const repo = run.evaluation?.repo;
    assert(
      typeof repo === "string" && repo.length > 0,
      `Missing evaluation repo for entry at index ${index}`,
    );

    const identifier = run.evaluation?.identifier ?? repo;
    assert(
      typeof identifier === "string" && identifier.length > 0,
      `Missing evaluation identifier for "${repo}" (index ${index})`,
    );

    assert(
      Array.isArray(run.scores),
      `Missing scores array for evaluation "${repo}" (index ${index})`,
    );

    assert(
      typeof run.jobUrl === "string" && run.jobUrl.length > 0,
      `Missing job URL for evaluation "${repo}" model "${run.model}"`,
    );

    const modelIds = Array.isArray(run.model) ? run.model : [run.model];
    const modelRows = run.scores.map((score) => ({
      name: score.assignment.name,
      weight: score.assignment.weight,
      normalizedWeight: score.normalizedWeight,
      average: score.averageScore,
      variance: score.variance,
    }));

    const summaries = evalMap.get(identifier) ?? [];

    modelIds.forEach((modelId) => {
      const agentName = (run.agent ?? "").trim();
      const prefixedId = `${agentName}:${modelId}`;

      summaries.push({
        id: prefixedId,
        rawModelId: modelId,
        agentId: agentName.length > 0 ? agentName : run.agent,
        final: run.finalScore,
        jobUrl: run.jobUrl,
        rows: modelRows,
        episodes: run.episodes,
      });
    });

    evalMap.set(identifier, summaries);
    if (!labelMap.has(identifier)) {
      labelMap.set(identifier, repo);
    }
  });

  return Array.from(evalMap.entries()).map(([identifier, models]) => ({
    eval: identifier,
    label: labelMap.get(identifier) ?? identifier,
    models,
  }));
}

/**
 * Builds a shareable QuickChart radar chart URL for a model's per-metric scores.
 * Currently unused in the Discord webhook, but retained for future scorecard embeds.
 */
function buildModelRadarChartUrl(
  model: ModelSummary,
  evalName: string,
): string | undefined {
  if (model.rows.length === 0) {
    return undefined;
  }

  return buildRadarChartUrl(
    {
      labels: model.rows.map((row) => row.name),
      values: model.rows.map((row) => Number(row.average.toFixed(3))),
      title: `${evalName} • ${model.id}`,
      datasetLabel: model.id,
    },
    { includeBackground: true, backgroundColor: "white" },
  );
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

  return buildBarChartUrl(
    {
      labels: sorted.map((entry) => entry.id),
      values: sorted.map((entry) => entry.score),
      title: `Average Performance by Model (${evalName})`,
    },
    { backgroundColor: "white" },
  );
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

  return buildBarChartUrl(
    {
      labels: averages.map((entry) => entry.id),
      values: averages.map((entry) => entry.score),
      title: "Average Performance by Model (All Evaluations)",
    },
    { backgroundColor: "white" },
  );
}

function loadAnalysisLinks(): Map<string, string> {
  const filePath = process.env.ANALYSIS_LINKS_FILE?.trim();
  if (!filePath) {
    return new Map();
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const entries = JSON.parse(raw) as AnalysisLinkEntry[];
    return new Map(
      entries
        .filter(
          (entry) =>
            typeof entry?.eval === "string" &&
            entry.eval.length > 0 &&
            typeof entry?.url === "string" &&
            entry.url.length > 0,
        )
        .map((entry) => [entry.eval, entry.url]),
    );
  } catch (error) {
    console.error(
      `[discord] Failed to load analysis links from ${filePath}:`,
      error,
    );
    return new Map();
  }
}

function buildPayloads(
  evalSummaries: EvalSummary[],
  analysisLinks: Map<string, string>,
): DiscordPayload[] {
  const contentLink = resolveContentLink();
  const overallChartUrl = buildOverallChartUrl(evalSummaries);

  const embeds = evalSummaries.map((summary) => {
    const fields = summary.models.map((model) => {
      const finalScore = model.final.toFixed(3);
      const decoratedValue = `[${finalScore}](${model.jobUrl})`;

      return {
        name: model.id,
        value: decoratedValue,
        inline: false,
      };
    });

    const averageChartUrl = buildAverageChartUrl(
      summary.label,
      summary.models,
    );

    const analysisLink = analysisLinks.get(summary.eval);
    assert(
      typeof analysisLink === "string" && analysisLink.length > 0,
      `Missing analysis link for evaluation "${summary.label}" (key: ${summary.eval}). Ensure analysis links are provided for every eval.`,
    );

    fields.push({
      name: "Analysis",
      value: `[Analysis](${analysisLink})`,
      inline: false,
    });

    return {
      title: summary.label,
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
  const analysisLinks = loadAnalysisLinks();
  const payloads = buildPayloads(evalSummaries, analysisLinks);

  console.log("===== Plain-text preview =====\n");
  for (const summary of evalSummaries) {
    console.log(`Eval: ${summary.label} (${summary.eval})`);
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
      // Add delay between messages to ensure proper ordering in Discord
      if (index < payloads.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to deliver Discord webhook: ${message}`);
    process.exitCode = 1;
  }
}

await main();
