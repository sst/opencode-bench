import { generateText } from "ai";
import { Task } from "./tasks/index.js";
import { getZenLanguageModel } from "./zenModels.js";
import { Eval } from "./eval.js";
import { average } from "./util/math.js";

export namespace Summarizer {
  const MODEL_ID = "opencode/claude-sonnet-4-5";
  export type RunsResult = Awaited<ReturnType<typeof summarizeRuns>>;
  export type TasksResult = Awaited<ReturnType<typeof summarizeTasks>>;

  export async function summarizeRuns(results: Eval.Result[]) {
    if (!results.length) throw new Error("No runs to summarize");
    if (
      results.some(
        (result) =>
          result.task !== results[0].task ||
          result.agent !== results[0].agent ||
          result.model !== results[0].model,
      )
    )
      throw new Error("Results must be for the same task, agent, and model");

    const task = await Task.get(results[0].task);
    const model = results[0].model;
    const averageDuration = average(results.map((result) => result.duration));
    const averageUsage = {
      input: average(results.map((result) => result.usage.input)),
      output: average(results.map((result) => result.usage.output)),
      cost: average(results.map((result) => result.usage.cost)),
    };
    const averageScore = average(results.map((result) => result.score.final));
    const summary = await (async () => {
      try {
        const result = await generateText({
          model: getZenLanguageModel(MODEL_ID),
          system: `
You are a technical summarizer that creates concise, informative summaries of autonomous agent activities across multiple evaluation episodes.

Your task:
- Analyze the actions taken by an AI agent across all separate episodes of the same task
- Identify common patterns, tools used, files modified, and key behaviors
- Produce a clear, structured summary that highlights what the agent did

Focus on:
- **Tool usage patterns**: Which tools were used most frequently
- **File modifications**: Which files were created, edited, or read
- **Common strategies**: What approach did the agent consistently take
- **Consistency**: Did the agent behave similarly across episodes, or vary significantly?
- **Outcomes**: Any errors, successes, or notable behaviors

Output format:
Write 2-4 paragraphs in a professional, technical style. Be concise but informative.

Structure:
1. **Overview**: Brief description of what the agent accomplished
2. **Approach**: Tools and strategies used consistently across episodes
3. **Key actions**: Specific files modified or critical operations performed
4. **Observations**: Any notable patterns, inconsistencies, or issues

Guidelines:
- Keep it under 300 words
- Use technical language but be clear
- Focus on patterns across episodes, not individual actions
- Mention specific tool names and file paths when relevant
- Note any errors or issues encountered
- Be objective and descriptive, not evaluative`.trim(),
          temperature: 0.3,
          prompt: `
Repository: ${task.source.repo}
Model: ${model}
Task: Implement changes from ${task.source.from} to ${task.source.to}

${results
  .map((result) => result.actions)
  .flatMap((actions, i) => {
    const len = actions.length;
    return [
      `### Episode ${i + 1}`,
      `Actions (${len} total):`,
      len > 50
        ? [...actions.slice(0, 50), `... (${len - 50} more actions)`].join("\n")
        : actions.join("\n"),
    ];
  })
  .join("\n\n")}

Provide a concise summary of what the agent did across these episodes.`.trim(),
        });

        return result.text.trim();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[summarizer] Failed to generate summary: ${message}`);
        return `Unable to generate summary: ${message}`;
      }
    })();
    return {
      task,
      model,
      agent: results[0].agent,
      averageDuration,
      averageUsage,
      averageScore,
      summary,
      runs: results,
    };
  }

  export async function summarizeTasks(results: RunsResult[]) {
    if (!results.length) throw new Error("No tasks to summarize");

    const averageScore = average(results.map((result) => result.averageScore));

    return {
      averageScore,
      tasks: results,
    };
  }
}
