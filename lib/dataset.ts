import { strict as assert } from "node:assert";

import datasetSource from "~/dataset.yaml";
import { scores as scoreRegistry } from "~/scores/index.js";
import { z } from "zod";

const scoreConfigSchema = z.object({
  weight: z.number().positive(),
  args: z.unknown().optional()
});

const datasetSchema = z.array(
  z.object({
    repo: z
      .string()
      .regex(/^[^/]+\/[^/]+$/, "repo must follow the format <owner>/<name>."),
    from: z.string().min(1, "from commit SHA is required."),
    to: z.string().min(1, "to commit SHA is required."),
    prompts: z.string().min(1, "prompts file path is required."),
    issues: z.array(z.number().int()),
    context: z.string().min(1).optional(),
    scores: z.record(scoreConfigSchema)
  })
);

type RawDatasetEntry = z.infer<typeof datasetSchema>[number];
type ScoreName = keyof typeof scoreRegistry;

export interface ScoreAssignment {
  name: ScoreName;
  weight: number;
  args?: unknown;
}

export interface DatasetEval extends Omit<RawDatasetEntry, "scores"> {
  identifier: string;
  scores: ScoreAssignment[];
}

const parsedDataset: RawDatasetEntry[] = datasetSchema.parse(datasetSource);
const knownScores = new Set(Object.keys(scoreRegistry) as ScoreName[]);

const seenIdentifiers = new Set<string>();

const datasetWithValidatedScores: DatasetEval[] = parsedDataset.map((entry) => {
  const shortSha = (sha: string) => sha.slice(0, 7);
  const identifier = `${entry.repo}@${shortSha(entry.from)}..${shortSha(entry.to)}`;
  assert(
    !seenIdentifiers.has(identifier),
    `dataset.yaml contains duplicate eval identifier "${identifier}".`,
  );
  seenIdentifiers.add(identifier);

  const normalizedScores = Object.entries(entry.scores).map(([name, config]) => {
    assert(
      knownScores.has(name as ScoreName),
      `dataset.yaml entry ${entry.repo} references unknown score "${name}".`
    );
    const weight = config.weight;
    assert(
      typeof weight === "number" && Number.isFinite(weight) && weight > 0,
      `dataset.yaml entry ${entry.repo} must define a positive weight for score "${name}".`
    );

    return {
      name: name as ScoreName,
      weight,
      args: config.args
    } satisfies ScoreAssignment;
  });

  return {
    ...entry,
    identifier,
    scores: normalizedScores
  };
});

export const dataset: ReadonlyArray<DatasetEval> = Object.freeze(datasetWithValidatedScores);
