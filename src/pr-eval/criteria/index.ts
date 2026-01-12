import type { PrEvalContext } from "../fetcher.js";
import * as scopeClarity from "./scope-clarity.js";
import * as technicalQuality from "./technical-quality.js";
import * as evalFeasibility from "./eval-feasibility.js";
import * as reproducibility from "./reproducibility.js";

export interface Criterion {
  systemPrompt: string;
  createUserPrompt: (context: PrEvalContext) => string;
}

export interface CriterionConfig {
  criterion: Criterion;
  weight: number;
  displayName: string;
}

export namespace PrCriteria {
  export const all: Record<string, CriterionConfig> = {
    "scope-clarity": {
      criterion: scopeClarity,
      weight: 0.25,
      displayName: "Scope & Clarity",
    },
    "technical-quality": {
      criterion: technicalQuality,
      weight: 0.25,
      displayName: "Technical Quality",
    },
    "eval-feasibility": {
      criterion: evalFeasibility,
      weight: 0.25,
      displayName: "Evaluation Feasibility",
    },
    reproducibility: {
      criterion: reproducibility,
      weight: 0.25,
      displayName: "Reproducibility",
    },
  };

  export const names = Object.keys(all) as Array<keyof typeof all>;
}
