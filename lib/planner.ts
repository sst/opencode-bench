import { generateObject } from "ai";
import { z } from "zod";

import type { DatasetEval } from "~/lib/dataset.js";
import { plannerExamples } from "~/lib/plannerExamples.js";
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

function sanitizePlannerPrompt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "Apply the referenced change precisely as described, without introducing unrelated work.";
  }

  return trimmed
    .replace(/\bcommits\b/gi, "changes")
    .replace(/\bcommit\b/gi, "change")
    .replace(/\bsource control\b/gi, "version control");
}

const baseSystemPrompt = `You are Planner, a planning assistant that turns a single Git commit's diff into an actionable directive for an execution agent.

Instructions:
- Understand the intent of the change from the diff and commit title provided.
- Produce a concise, self-contained todo-style instruction that tells the execution agent what to implement.
- Focus on the desired outcome and intent; reference filenames only when critical.
- Be precise about goals and acceptance criteria, but avoid expanding into low-level implementation steps or exhaustive bullet lists.
- Describe the change at an intent level. summarise what needs to be added/removed and call out critical details, but do not paste large blocks verbatim unless unavoidable—the agent should supply the exact wording or code.
- Avoid line-by-line directions such as “insert this exact line after …”. Instead, explain the goal (“add the new npm script so it runs the TSX entrypoint”) and let the execution agent decide the precise placement and wording.
- Stay within the scope of the diff. Do not request unrelated work, but it is acceptable for the agent to choose reasonable phrasing or structure as long as the diff’s intent is achieved.
- Do not mention commit hashes, commit history, or that the instructions originated from a commit; speak directly to the execution agent about the required work.
- Phrase the instruction as a direct task (e.g., “Ship…”, “Verify…”, “Refine…”) rather than a meta prompt or “You should”.
- Write from the perspective of a senior developer handing off work to a teammate. Keep the tone professional, pragmatic, and naturally human—no robotic phrasing or unnecessary verbosity.
- All changes should be as tested and production-ready as if you were committing them yourself. The agent should be instructed to "run" or "build" or "test" as appropriate to ensure quality.

Always respond strictly as JSON conforming to the schema. Do not add commentary.`;

const plannerModelId = fallback("PLANNER_MODEL", "opencode/claude-sonnet-4-5");

function buildSystemPrompt(): string {
  if (plannerExamples.length === 0) {
    return baseSystemPrompt;
  }

  const examplesSection = plannerExamples
    .map(
      (example, index) =>
        `Example ${index + 1} diff:\n${example.diff}\n\nExample ${index + 1} instruction:\n${example.prompt}`,
    )
    .join("\n\n---\n\n");

  return `${baseSystemPrompt}\n\n---\n${examplesSection}`;
}

export async function generatePlannerTask(
  entry: DatasetEval,
  commit: PlannerCommitDiff,
): Promise<PlannerTask> {
  const truncatedDiff =
    commit.diff.length > 50_000
      ? `${commit.diff.slice(0, 50_000)}\n... [truncated]`
      : commit.diff;

  try {
    const result = await generateObject({
      model: getZenLanguageModel(plannerModelId),
      schema: plannerSchema,
      system: buildSystemPrompt(),
      temperature: 0,
      prompt: `Repository: ${entry.repo}
Base commit: ${entry.from}
Target commit: ${entry.to}

Commit: ${commit.sha}
Title: ${commit.title}
Diff:
${truncatedDiff}

Return the JSON object describing the task.`,
    });

    const trimmedCommit = result.object.commit.trim();
    return {
      commit: trimmedCommit.length > 0 ? trimmedCommit : commit.sha,
      prompt: sanitizePlannerPrompt(result.object.prompt),
    };
  } catch (error) {
    const formatted =
      error instanceof Error ? error : new Error(String(error));
    formatted.message = `Planner failed for commit ${commit.sha} in ${entry.repo}: ${formatted.message}`;
    throw formatted;
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
