export interface PlannerExample {
  diff: string;
  prompt: string;
}

import diff_d7763789f262b2da228f8210509e302e6e510d0a from "~/planner/examples/d7763789f262b2da228f8210509e302e6e510d0a.txt";

export const plannerExamples: PlannerExample[] = [
  {
    diff: diff_d7763789f262b2da228f8210509e302e6e510d0a,
    prompt: `Add a metric to track Lambda batch item failures. When Lambda functions return a response containing batch item failures (the batchItemFailures field), we should emit a count of how many items failed as an enhanced metric. This should only happen when enhanced metrics are enabled and the response structure is valid. Follow existing codebase patterns for function signatures and integration points. Include comprehensive test coverage for various scenarios including responses with failures, empty failures, missing fields, and edge cases.`,
  },
];
