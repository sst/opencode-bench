import { generateObject } from "ai";
import { z } from "zod";

import type { DatasetEval } from "~/lib/dataset.js";
import { getZenLanguageModel } from "~/lib/zenModels.js";

const fallback = (envName: string, defaultValue: string): string =>
  process.env[envName]?.trim() || defaultValue;

export interface PlannerCommitDiff {
  sha: string;
  title: string;
  diff: string;
}

export interface PlannerTask {
  commit: string;
  prompt: string;
}

const plannerSchema = z.object({
  commit: z.string().min(7),
  prompt: z.string().min(1),
});

const systemPrompt = `You are Planner, a planning assistant that turns a single Git commit's diff into an actionable directive for an execution agent.

Instructions:
- Understand the intent of the change from the diff and commit title provided.
- Produce a concise, self-contained todo-style instruction that tells the execution agent what to implement.
- Focus on the desired outcome and intent; reference filenames only when critical.
- Be precise about goals and acceptance criteria, but avoid expanding into low-level implementation steps or exhaustive bullet lists.
- Do not mention commit hashes, commit history, or that the instructions originated from a commit; speak directly to the execution agent about the required work.
- Phrase the instruction as a direct task (e.g., “Ship…”, “Verify…”, “Refine…”) rather than a meta prompt or “You should”.

Always respond strictly as JSON conforming to the schema. Do not add commentary.`;

const plannerModelId = fallback("PLANNER_MODEL", "opencode/gpt-5");

export async function generatePlannerTask(
  entry: DatasetEval,
  commit: PlannerCommitDiff,
): Promise<PlannerTask> {
  const truncatedDiff =
    commit.diff.length > 50_000
      ? `${commit.diff.slice(0, 50_000)}\n... [truncated]`
      : commit.diff;

  try {
    const { object } = await generateObject({
      model: getZenLanguageModel(plannerModelId),
      schema: plannerSchema,
      system: systemPrompt,
      prompt: `Repository: ${entry.repo}
Base commit: ${entry.from}
Target commit: ${entry.to}

Commit: ${commit.sha}
Title: ${commit.title}
Diff:
${truncatedDiff}

Return the JSON object describing the task.`,
    });

    const trimmedCommit = object.commit.trim();
    return {
      commit: trimmedCommit.length > 0 ? trimmedCommit : commit.sha,
      prompt: object.prompt.trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Planner failed for commit ${commit.sha} in ${entry.repo}: ${message}. Falling back to commit title.`,
    );

    return {
      commit: commit.sha,
      prompt: `Deliver the work described by "${commit.title.trim() || "the latest changes"}" without referencing source control history.`,
    };
  }
}

export async function generatePlannerTasks(
  entry: DatasetEval,
  commits: PlannerCommitDiff[],
): Promise<PlannerTask[]> {
  const tasks = await Promise.all(
    commits.map((commit) => generatePlannerTask(entry, commit)),
  );

  return tasks;
}
