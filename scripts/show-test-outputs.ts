/**
 * Script to show full judge consistency test outputs
 */
import { generateObject } from "ai";
import { scoreResultSchema } from "~/lib/createScore.js";
import { judges } from "~/lib/judges.js";
import { systemPrompt as logicEquivalencePrompt } from "~/metrics/logic-equivalence.js";
import { systemPrompt as apiSignaturePrompt } from "~/scores/api-signature.js";
import {
  logicEquivalenceFixtures,
  apiSignatureFixtures,
} from "~/types/tests/fixtures/judgeConsistencyFixtures.js";

const judge = judges[0]; // claude-4.5

async function evaluateAndShow(
  name: string,
  systemPrompt: string,
  reference: string,
  candidate: string,
  scoreType: string,
) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`TEST: ${name}`);
  console.log(`${"=".repeat(80)}\n`);

  const userPrompt =
    scoreType === "logic"
      ? `Reference diff:\n${reference}\n\nCandidate diff:\n${candidate}\n\nCompare ONLY the logical behavior (conditions, edge cases, side effects). Ignore code structure and style. Respond with JSON.`
      : `Reference diff:\n${reference}\n\nCandidate diff:\n${candidate}\n\nCompare ONLY the API signatures (function names, parameter order, parameter names). Ignore implementation details. Respond with JSON.`;

  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- Run ${i} ---\n`);

    const { object } = await generateObject({
      model: judge.model,
      schema: scoreResultSchema,
      system: systemPrompt,
      temperature: 0,
      prompt: userPrompt,
    });

    console.log(`Score: ${object.score}`);
    console.log(`\nRationale:\n${object.rationale}`);
    console.log();
  }
}

// Run tests
(async () => {
  console.log("JUDGE CONSISTENCY TEST OUTPUT - FULL RATIONALES");
  console.log("Using judge: claude-4.5");

  // Logic Equivalence - Perfect Match
  await evaluateAndShow(
    "Logic Equivalence - Perfect Match",
    logicEquivalencePrompt,
    logicEquivalenceFixtures.perfect.reference,
    logicEquivalenceFixtures.perfect.candidate,
    "logic",
  );

  // Logic Equivalence - Wrong Implementation
  await evaluateAndShow(
    "Logic Equivalence - Wrong Implementation",
    logicEquivalencePrompt,
    logicEquivalenceFixtures.wrong.reference,
    logicEquivalenceFixtures.wrong.candidate,
    "logic",
  );

  // Logic Equivalence - Ambiguous
  await evaluateAndShow(
    "Logic Equivalence - Ambiguous (Guard vs Nested)",
    logicEquivalencePrompt,
    logicEquivalenceFixtures.ambiguous.reference,
    logicEquivalenceFixtures.ambiguous.candidate,
    "logic",
  );

  // API Signature - Perfect Match
  await evaluateAndShow(
    "API Signature - Perfect Match",
    apiSignaturePrompt,
    apiSignatureFixtures.perfect.reference,
    apiSignatureFixtures.perfect.candidate,
    "api",
  );

  // API Signature - Wrong Implementation
  await evaluateAndShow(
    "API Signature - Wrong Implementation (Parameter Name)",
    apiSignaturePrompt,
    apiSignatureFixtures.wrong.reference,
    apiSignatureFixtures.wrong.candidate,
    "api",
  );

  // API Signature - Ambiguous
  await evaluateAndShow(
    "API Signature - Ambiguous (Parameter Order)",
    apiSignaturePrompt,
    apiSignatureFixtures.ambiguous.reference,
    apiSignatureFixtures.ambiguous.candidate,
    "api",
  );

  console.log(`\n${"=".repeat(80)}`);
  console.log("ALL TESTS COMPLETE");
  console.log(`${"=".repeat(80)}\n`);
})();
