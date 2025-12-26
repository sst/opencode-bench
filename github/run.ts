#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { Logger } from "../src/util/logger.js";
import { Eval } from "../src/eval.js";
import { sanitizeFilename } from "../src/util/fs.js";

const task = process.env.TASK!;
const model = process.env.MODEL!;
const agent = process.env.AGENT!;
const resultPath = sanitizeFilename(process.env.RESULT_PATH!);

// Run eval
const result = await Eval.run(agent, model, task, {
  logger: Logger.create(`[model ${model}]`),
});

// Store result
await writeFile(resultPath, JSON.stringify(result));

process.exit();
