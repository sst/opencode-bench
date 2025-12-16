import { z } from "zod";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileExists } from "../lib/fs.js";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { Logger } from "../lib/logger.js";
import {
  CommitDiff,
  fetchCommits,
  fetchComparisonDiff,
} from "../lib/github.js";
import { generateObject } from "ai";
import { getZenLanguageModel } from "../lib/zenModels.js";

export namespace Eval {
  const EVAL_PATH = __dirname;
  const SAMPLE_DATASET_NAME = "_sample";
  const SAMPLE_DATASET_PATH = join(EVAL_PATH, SAMPLE_DATASET_NAME);
  const MODEL_ID = "opencode/claude-sonnet-4-5";
  const definitionSchema = z.object({
    repo: z
      .string()
      .regex(/^[^/]+\/[^/]+$/, "repo must follow the format <owner>/<name>."),
    from: z.string().min(1, "from commit SHA is required."),
    to: z.string().min(1, "to commit SHA is required."),
    issues: z.array(z.number().int()),
    context: z.string().min(1).optional(),
    scores: z.array(
      z.object({
        name: z.string().min(1),
        weight: z.number().positive(),
        args: z.unknown().optional(),
      }),
    ),
  });
  const promptSchema = z.object({
    commit: z.string().min(7),
    prompt: z.string().min(1),
  });
  const promptsSchema = z.object({
    generated_at: z.string(),
    prompts: z.array(promptSchema),
  });
  export type Instance = Awaited<ReturnType<typeof load>>[number];

  export async function load() {
    const folders = await listNames();
    return await Promise.all(
      folders.map(async (folderName) => {
        const [defYml, promptYml, diff] = await Promise.all([
          readFile(join(EVAL_PATH, folderName, "definition.yml"), "utf-8"),
          readFile(join(EVAL_PATH, folderName, "prompt.yml"), "utf-8"),
          readFile(join(EVAL_PATH, folderName, "diff.patch"), "utf-8"),
        ]);
        return {
          ...definitionSchema.parse(parseYaml(defYml)),
          id: folderName,
          //id: `${def.repo}@${def.from.slice(0, 7)}..${def.to.slice(0, 7)}`,
          prompts: promptsSchema.parse(parseYaml(promptYml)).prompts,
          diff: diff.trim(),
        };
      }),
    );
  }

  export async function generate(opts: { logger: Logger.Instance }) {
    opts.logger.log(`Starting dataset generation...`);
    const folders = await listNames();
    opts.logger.log(`Found ${folders.length} evaluations`);

    for (const folderName of folders) {
      const logger = opts.logger.child(`[${folderName}]`);

      try {
        logger.log(`Parsing eval definition...`);
        const defYml = await readFile(
          join(EVAL_PATH, folderName, "definition.yml"),
          "utf-8",
        );
        const def = definitionSchema.parse(parseYaml(defYml));
        const [owner, repo] = def.repo.split("/", 2);

        // generate diff
        const diffPath = join(EVAL_PATH, folderName, "diff.patch");
        if (!(await fileExists(diffPath))) {
          logger.log(`Fetching eval commits from GitHub...`);
          const diff = await fetchComparisonDiff(owner, repo, def.from, def.to);
          if (diff.trim().length === 0)
            throw new Error(logger.format(`Diff is empty for ${def.repo}`));
          await writeFile(diffPath, diff, "utf-8");
        }

        // generate prompts
        const promptPath = join(EVAL_PATH, folderName, "prompt.yml");
        if (!(await fileExists(promptPath))) {
          logger.log(`Generating eval prompts...`);
          const commits = await fetchCommits(owner, repo, def.from, def.to);
          if (commits.length === 0)
            throw new Error(logger.format("No commits found"));

          const prompts = await Promise.all(
            commits.map((diff) =>
              generatePrompt(def, diff, {
                logger: logger.child(`[commit ${diff.sha.slice(0, 7)}]`),
              }),
            ),
          );

          await writeFile(
            promptPath,
            stringifyYaml(
              { generated_at: new Date().toISOString(), prompts },
              { lineWidth: 0 },
            ),
            "utf-8",
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to generate dataset: ${message}`);
        throw error;
      }
    }
  }

  export async function listNames() {
    const folders = await readdir(EVAL_PATH, { withFileTypes: true });
    return await Promise.all(
      folders
        .filter((folder) => folder.isDirectory())
        .filter((folder) => folder.name !== SAMPLE_DATASET_NAME)
        .map((folder) => folder.name)
        .sort((a, b) => a.localeCompare(b)),
    );
  }

  async function generatePrompt(
    def: z.infer<typeof definitionSchema>,
    diff: CommitDiff,
    opts: { logger: Logger.Instance },
  ) {
    try {
      const result = await generateObject({
        model: getZenLanguageModel(MODEL_ID),
        schema: promptSchema,
        system: [
          `
You are Planner, a planning assistant that turns a single Git commit's diff into an actionable directive for an execution agent.

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

Always respond strictly as JSON conforming to the schema. Do not add commentary.`.trim(),
          "",
          "---",
          "Example diff:",
          await readFile(join(SAMPLE_DATASET_PATH, "diff.patch"), "utf-8"),
          "",
          "Example instruction:",
          await readFile(join(SAMPLE_DATASET_PATH, "prompt.yml"), "utf-8"),
        ].join("\n"),
        temperature: 0,
        prompt: [
          `Repository: ${def.repo}`,
          `Base commit: ${def.from}`,
          `Target commit: ${def.to}`,
          "",
          ...(def.context
            ? ["Additional maintainer context:", def.context, ""]
            : []),
          `Commit: ${diff.sha}`,
          `Title: ${diff.title}`,
          `Diff: ${
            diff.diff.length > 50_000
              ? `${diff.diff.slice(0, 50_000)}\n... [truncated]`
              : diff.diff
          }`,
          "",
          "Return the JSON object describing the task.",
        ].join("\n"),
      });

      return {
        commit: diff.sha,
        prompt: result.object.prompt,
      };
    } catch (e) {
      opts.logger.error("Failed to generate prompt");
      throw e;
    }
  }
}
