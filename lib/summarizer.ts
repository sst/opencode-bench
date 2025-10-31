import { generateText } from "ai";
import { z } from "zod";

import type { DatasetEval } from "~/lib/dataset.js";
import { getZenLanguageModel } from "~/lib/zenModels.js";

const fallback = (envName: string, defaultValue: string): string =>
  process.env[envName]?.trim() || defaultValue;

export interface EpisodeActions {
  episodeIndex: number;
  actions: string[];
}

const systemPrompt = `You are a technical summarizer that creates concise, informative summaries of autonomous agent activities across multiple evaluation episodes.

Your task:
- Analyze the actions taken by an AI agent across 3 separate episodes of the same task
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
- Be objective and descriptive, not evaluative`;

const summarizerModelId = fallback(
  "SUMMARIZER_MODEL",
  "opencode/claude-sonnet-4-5",
);

export async function generateActionsSummary(
  evaluation: DatasetEval,
  model: string,
  episodesActions: EpisodeActions[],
): Promise<string> {
  if (episodesActions.length === 0) {
    return "No actions recorded";
  }

  // Build a structured prompt with the actions data
  const episodesSummary = episodesActions
    .map((ep) => {
      const sample = ep.actions.slice(0, 50); // First 50 actions per episode
      const truncated =
        ep.actions.length > 50
          ? `\n... (${ep.actions.length - 50} more actions)`
          : "";

      return `### Episode ${ep.episodeIndex}
Actions (${ep.actions.length} total):
${sample.join("\n")}${truncated}`;
    })
    .join("\n\n");

  const prompt = `Repository: ${evaluation.repo}
Model: ${model}
Task: Implement changes from ${evaluation.from.slice(0, 7)} to ${evaluation.to.slice(0, 7)}

${episodesSummary}

Provide a concise summary of what the agent did across these episodes.`;

  try {
    const result = await generateText({
      model: getZenLanguageModel(summarizerModelId),
      system: systemPrompt,
      temperature: 0.3,
      prompt,
    });

    return result.text.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[summarizer] Failed to generate summary: ${message}`);
    return `Unable to generate summary: ${message}`;
  }
}
