#!/usr/bin/env bun
import process from "node:process";
import { writeFile } from "node:fs/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Agent } from "~/src/agents/index.js";
import { Task } from "~/src/tasks/index.js";
import { Summarizer } from "~/src/summarizer.js";
import { Logger } from "~/src/util/logger.js";
import { Eval } from "./src/eval.js";

const cli = yargs(hideBin(process.argv))
  .scriptName("orvl")
  .wrap(null)
  .version(false)
  .help("help", "show help")
  .alias("help", "h")
  .example([
    [
      "$0 opencode --model opencode/gpt-5-codex --task DataDog/datadog-lambda-python@93d4a07..d776378",
    ],
  ])
  .strict();

cli.command(
  "generate",
  "Generate dataset for all tasks",
  async (yargs) =>
    yargs.example([["orvl generate", "Generate dataset for all tasks"]]),
  async () => {
    const logger = Logger.create("[generate]");
    await Task.generate({ logger });
  },
);

cli.command(
  "$0 [agent]",
  "Run benchmark",
  async (yargs) =>
    yargs
      .positional("agent", {
        type: "string",
        description: "agent to use",
        choices: Agent.list().map((agent) => agent.name),
        required: true,
      })
      .option("model", {
        type: "string",
        description: "model to use in the format of provider/model",
        required: true,
      })
      .option("task", {
        type: "string",
        description: "task to use in the format of repo@from..to",
        required: true,
      }),
  async ({ agent: agentName, model: modelId, task: taskId }) => {
    if (!agentName) throw new Error("Agent name is required");

    const logger = Logger.create(`[model ${modelId}]`);

    // Run eval
    const result = await Eval.run(agentName, modelId, taskId, { logger });

    // Summary episodes
    const summary = await Summarizer.summarizeRuns([result]);

    // Print summary
    const formatUsage = (usage: { input: number; output: number }) =>
      `${usage.input} input / ${usage.output} output`;
    const formatScore = (score: Eval.Result["score"]) => {
      const final = score.final.toFixed(3);
      const base = score.base.toFixed(3);
      const penalty = score.penalty.toFixed(3);
      return `${final} (base ${base} - penalty ${penalty})`;
    };
    logger.log(`Final score: ${summary.averageScore.toFixed(3)}`);
    logger.log(`Avg duration: ${(summary.averageDuration / 1000).toFixed(0)}s`);
    logger.log(`Avg usage: ${formatUsage(summary.averageUsage)}`);
    logger.log(`Avg cost: $${summary.averageUsage.cost.toFixed(2)}`);
    summary.runs.forEach((result, i) => {
      logger.log(`Episode ${i + 1}:`);
      logger.log(`  Actions: ${result.actions.length}`);
      logger.log(`  Usage: ${formatUsage(result.usage)}`);
      logger.log(`  Cost: $${result.usage.cost.toFixed(2)}`);
      logger.log(`  Duration: ${(result.duration / 1000).toFixed(0)}s`);
      logger.log(`  Score: ${formatScore(result.score)}`);
      result.scoreDetails.forEach((score) => {
        logger.log(`    Criterion: ${score.criterion}`);
        score.judges.forEach((judge) => {
          logger.log(`      ${judge.judge}: ${judge.score.toFixed(3)}`);
        });
      });
    });

    // Build chart
    //const chartUrl = buildRadarChartUrl({
    //  labels: result.scoreDetails.map((s) => s.criterion),
    //  values: result.scoreDetails.map((s) => Number(s.average.toFixed(3))),
    //  title: `${taskId} • ${modelId}`,
    //  datasetLabel: modelId,
    //});
    //logger.log(`Radar Chart: ${chartUrl}\n`);
  },
);

try {
  await cli.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Cleanup all loaded agents
  const agents = Agent.list();
  for (const agent of agents) {
    if (agent.definition.cleanup) {
      await agent.definition.cleanup();
    }
  }
  process.exit();
}
