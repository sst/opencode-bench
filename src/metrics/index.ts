import * as apiSignature from "./api-signature.js";
import * as logicEquivalence from "./logic-equivalence.js";
import * as integrationPoints from "./integration-points.js";
import * as testCoverage from "./test-coverage.js";
import * as checks from "./checks.js";

export namespace Metric {
  export type Context = {
    expectedDiff: string;
    actualDiff: string;
    beforeResults?: CommandExecution[];
    afterResults?: CommandExecution[];
  };

  export interface CommandExecution {
    command: string;
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    runtimeMs: number;
    errorMessage?: string;
  }

  export const all = {
    "api-signature": apiSignature,
    "logic-equivalence": logicEquivalence,
    "integration-points": integrationPoints,
    "test-coverage": testCoverage,
    checks,
  };
}
