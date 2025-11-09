import { generateObject } from "ai";
import { z } from "zod";

import type { DatasetEval } from "~/lib/dataset.js";
import { plannerExamples } from "~/lib/plannerExamples.js";
import { getZenLanguageModel } from "~/lib/zenModels.js";

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse, stringify } from "yaml";
import assert from "node:assert";
import { CommitDiff, fetchCommitDiffs } from "./github.js";

export interface Task {
  commit: string;
  prompt: string;
}

const schema = z.object({
  commit: z.string().min(7),
  prompt: z.string().min(1),
});

const baseSystemPrompt = `You are Planner, a planning assistant that turns a single Git commit's diff into an actionable directive for an execution agent.

Instructions:
- Understand the intent of the change from the diff and commit title provided.
- Produce a concise, self-contained todo-style instruction that tells the execution agent what to implement.
- Focus on the desired outcome and intent; reference filenames only when critical.
- Be precise about goals and acceptance criteria, but avoid expanding into low-level implementation steps or exhaustive bullet lists.
- Describe the change at an intent level. summarise what needs to be added/removed and call out critical details, but do not paste large blocks verbatim unless unavoidable—the agent should supply the exact wording or code.
- Avoid line-by-line directions such as "insert this exact line after …". Instead, explain the goal ("add the new npm script so it runs the TSX entrypoint") and let the execution agent decide the precise placement and wording.
- Stay within the scope of the diff. Do not request unrelated work, but it is acceptable for the agent to choose reasonable phrasing or structure as long as the diff's intent is achieved.
- When applicable, include realistic guidance to follow existing patterns in the codebase (e.g., "follow existing patterns for function signatures")—this is a natural constraint users often mention and helps agents make design choices consistent with the codebase.
- Do not mention commit hashes, commit history, or that the instructions originated from a commit; speak directly to the execution agent about the required work.
- Phrase the instruction as a direct task (e.g., "Ship…", "Verify…", "Refine…") rather than a meta prompt or "You should".
- Write from the perspective of a senior developer handing off work to a teammate. Keep the tone professional, pragmatic, and naturally human—no robotic phrasing or unnecessary verbosity.
- All changes should be as tested and production-ready as if you were committing them yourself. The agent should be instructed to "run" or "build" or "test" as appropriate to ensure quality.

What NOT to include:
- DO NOT specify exact function or variable names unless they are critical to the intent
- DO NOT specify exact file locations unless the location itself is the point of the change
- DO NOT list implementation steps like "create function X, then call it from Y"
- DO NOT dictate method signatures, parameter names, or internal structure
- DO NOT include code snippets unless they represent critical external examples or documentation

Always respond strictly as JSON conforming to the schema. Do not add commentary.`;

const plannerModelId = "opencode/claude-sonnet-4-5";

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

async function generateTask(
  entry: DatasetEval,
  commit: CommitDiff,
): Promise<Task> {
  const truncatedDiff =
    commit.diff.length > 50_000
      ? `${commit.diff.slice(0, 50_000)}\n... [truncated]`
      : commit.diff;

  const additionalContext = entry.context
    ? `Additional maintainer context:\n${entry.context}\n\n`
    : "";

  try {
    const result = await generateObject({
      model: getZenLanguageModel(plannerModelId),
      schema,
      system: buildSystemPrompt(),
      temperature: 0,
      prompt: `Repository: ${entry.repo}
Base commit: ${entry.from}
Target commit: ${entry.to}

${additionalContext}Commit: ${commit.sha}
Title: ${commit.title}
Diff:
${truncatedDiff}

Return the JSON object describing the task.`,
    });

    return {
      commit: commit.sha,
      prompt: result.object.prompt,
    };
  } catch (error) {
    const formatted = error instanceof Error ? error : new Error(String(error));
    formatted.message = `Planner failed for commit ${commit.sha} in ${entry.repo}: ${formatted.message}`;
    throw formatted;
  }
}

async function generateTasks(
  entry: DatasetEval,
  commits: CommitDiff[],
): Promise<Task[]> {
  const tasks = await Promise.all(
    commits.map((commit) => generateTask(entry, commit)),
  );

  return tasks;
}

const promptFileSchema = z.object({
  generated_at: z.string(),
  prompts: z.array(
    z.object({
      commit: z.string().min(7),
      prompt: z.string().min(1),
    }),
  ),
});

export type PromptsFile = z.infer<typeof promptFileSchema>;

export function loadPromptsFile(filePath: string): Task[] {
  assert(
    promptsFileExists(filePath),
    `Prompts file not found: ${filePath}. Run the prompts command to create it.`,
  );

  const content = readFileSync(filePath, "utf-8");
  const parsed = parse(content);
  const validated = promptFileSchema.parse(parsed);

  return validated.prompts;
}

function savePromptsFile(filePath: string, tasks: Task[]): void {
  const promptsFile: PromptsFile = {
    generated_at: new Date().toISOString(),
    prompts: tasks,
  };

  const yamlContent = stringify(promptsFile, {
    lineWidth: 0, // Disable line wrapping
  });

  writeFileSync(filePath, yamlContent, "utf-8");
}

function promptsFileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export async function generatePromptsForEval(
  evalDef: DatasetEval,
): Promise<void> {
  const evalId = evalDef.repo;
  const promptsPath = evalDef.prompts;

  console.log(`[${evalId}] Generating prompts...`);

  try {
    console.log(`[${evalId}] Fetching commit diffs from GitHub...`);
    const commitDiffs = await fetchCommitDiffs(evalDef);

    assert(
      commitDiffs.length > 0,
      `No commits found between ${evalDef.from} and ${evalDef.to} for ${evalDef.repo}.`,
    );

    console.log(
      `[${evalId}] Found ${commitDiffs.length} commits, generating prompts...`,
    );
    const plannerTasks = await generateTasks(evalDef, commitDiffs);

    assert(
      plannerTasks.length > 0,
      `Planner produced no tasks for ${evalDef.repo} (${evalDef.from}..${evalDef.to}).`,
    );

    console.log(
      `[${evalId}] Saving ${plannerTasks.length} prompts to ${promptsPath}...`,
    );
    savePromptsFile(promptsPath, plannerTasks);

    console.log(`[${evalId}] Successfully generated prompts!`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${evalId}] Failed to generate prompts: ${message}`);
    throw error;
  }
}
