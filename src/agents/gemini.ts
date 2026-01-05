import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

import type { Agent } from "./index.js";

export const models = [
  "gemini-2.0-flash-thinking-exp",
  "gemini-2.0-flash-exp",
  "gemini-exp-1206",
  "gemini-1.5-pro",
] as const;

const GEMINI_CLI_PATH = path.resolve(
  process.cwd(),
  "node_modules/@google/gemini-cli/dist/index.js"
);

function logJson(value: unknown, options: Agent.RunOptions): void {
  let message: string;
  try {
    message = JSON.stringify(value);
  } catch (error) {
    message = JSON.stringify({
      error: "serialization_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  process.stdout.write(`${options.logger.format(message)}\n`);
}

const geminiAgent: Agent.Definition = {
  async run(model, prompt, options) {
    options.logger.log(`gemini --model ${model} ${prompt}`);

    const actions: string[] = [];
    const usage = {
      input: 0,
      output: 0,
      cost: 0,
    };

    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          GEMINI_CLI_PATH,
          prompt,
          "--model",
          model,
          "--output-format",
          "stream-json",
          "--yolo",
          "--no-color",
        ],
        {
          cwd: options.cwd,
          env: {
            ...process.env,
            NO_COLOR: "1",
          },
        }
      );

      const stdoutInterface = createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      stdoutInterface.on("line", (line) => {
        if (!line.trim()) return;
        try {
          // Attempt to parse JSON line
          const event = JSON.parse(line);

          // Log the event as the other agents do
          logJson(event, options);

          if (event.type === "message" || event.type === "tool_use" || event.type === "tool_result") {
            actions.push(JSON.stringify(event));
          } else if (event.type === "result") {
            // Result event might contain final stats
            if (event.usage) {
              usage.input = event.usage.inputTokens || event.usage.promptTokenCount || 0;
              usage.output = event.usage.outputTokens || event.usage.candidatesTokenCount || 0;
              // cost calculation would require pricing info
            }
          } else if (event.type === "error") {
             options.logger.error("Gemini CLI error:", event);
          }
        } catch (e) {
          // If not JSON, just log as debug
          options.logger.debug(`Gemini CLI stdout: ${line}`);
        }
      });

      child.stderr.on("data", (data) => {
        // Log stderr but don't treat as fatal error unless exit code is non-zero
        options.logger.debug(`gemini stderr: ${data.toString()}`);
      });

      child.on("close", (code) => {
        if (code !== 0 && actions.length === 0) {
          reject(new Error(`Gemini CLI process exited with code ${code}`));
        } else {
          resolve({ actions, usage });
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  },
};

export default geminiAgent;
