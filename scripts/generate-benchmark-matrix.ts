#!/usr/bin/env bun
import { Agent } from "~/agents/index.js";
import { Task } from "~/src/tasks/index.js";

// Note: Models are no longer hardcoded per agent.
// This script now generates an empty matrix since models should be specified externally.
const agents = Agent.list();
const tasks = await Task.listNames();
const include: any[] = [];

const matrix = JSON.stringify({ include });
process.stdout.write(matrix);
process.exit();
