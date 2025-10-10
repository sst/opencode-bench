import { strict as assert } from "node:assert";

import datasetSource from "~/dataset.yaml";
import { scores as scoreRegistry } from "~/scores/index.js";
import { z } from "zod";

const datasetSchema = z.array(
  z.object({
    repo: z
      .string()
      .regex(/^[^/]+\/[^/]+$/, "repo must follow the format <owner>/<name>."),
    from: z.string().min(1, "from commit SHA is required."),
    to: z.string().min(1, "to commit SHA is required."),
    prompt: z.string().min(1, "prompt is required."),
    commit_message: z.string().min(1, "commit message is required."),
    issues: z.array(z.number().int()),
    scores: z.record(z.number().positive())
  })
);

type RawDatasetEntry = z.infer<typeof datasetSchema>[number];
type ScoreName = keyof typeof scoreRegistry;

export interface ScoreAssignment {
  name: ScoreName;
  weight: number;
}

export interface DatasetEval extends Omit<RawDatasetEntry, "scores"> {
  scores: ScoreAssignment[];
}

const parsedDataset: RawDatasetEntry[] = datasetSchema.parse(datasetSource);
const knownScores = new Set(Object.keys(scoreRegistry) as ScoreName[]);

const datasetWithValidatedScores: DatasetEval[] = parsedDataset.map((entry) => {
  const normalizedScores = Object.entries(entry.scores).map(([name, weight]) => {
    assert(
      knownScores.has(name as ScoreName),
      `dataset.yaml entry ${entry.repo} references unknown score "${name}".`
    );
    assert(
      typeof weight === "number" && Number.isFinite(weight) && weight > 0,
      `dataset.yaml entry ${entry.repo} must define a positive weight for score "${name}".`
    );

    return {
      name: name as ScoreName,
      weight
    } satisfies ScoreAssignment;
  });

  return {
    ...entry,
    scores: normalizedScores
  };
});

export const dataset: ReadonlyArray<DatasetEval> = Object.freeze(datasetWithValidatedScores);
