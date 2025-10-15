import { execSync } from "node:child_process";
import { strict as assert } from "node:assert";

import { generateObject } from "ai";

import { createScore, scoreResultSchema } from "~/lib/createScore.js";
import { fetchComparisonDiff } from "~/lib/github.js";
import { finalizeAgentChanges } from "~/lib/finalizeAgentChanges.js";

const systemPrompt = `You are the judge for how faithfully an autonomous agent reproduced a reference git commit.

IMPORTANT: You must select exactly ONE of these discrete scores: 0, 0.25, 0.5, 0.75, or 1.0. Do not use intermediate values.
When borderline between two levels, round UP to the higher score if the candidate demonstrates effort toward that level's requirements.

Scoring rubric:

1.0 - Perfect Match
- Touches exactly the same files
- Produces identical behavior
- No extra logic added
- README/docs: Commands, flags, and setup steps match exactly (only punctuation/flow tweaks allowed)
Examples:
  • Reference adds "npm run dev" to README, updates server.ts to use port 3000, modifies config.json → Candidate does all three with only minor README phrasing differences
  • Reference removes deprecated getUserById(), replaces 5 call sites with fetchUser() → Candidate does exactly the same

0.75 - Cosmetic Differences Only
- All files touched correctly
- Functionally identical (same APIs, same arguments, same control flow)
- Only differences: variable names, code formatting, comment wording, documentation phrasing
- No behavioral changes whatsoever
Examples:
  • Reference: function calculate(data) → Candidate: function calculate(items) (different param names only)
  • Reference adds auth with auth.login(username, password) → Candidate uses auth.login(user, pass) with added code comments
  • Reference updates README "Run the following command: npm install" → Candidate "Install dependencies using npm install"

0.5 - Functional but Divergent
- Majority of required changes present
- Some files or edits missing
- Core functionality works but uses different approaches (different APIs, alternative implementations)
- May have minor behavioral differences
Examples:
  • Reference implements auth with passport.authenticate('local') → Candidate uses custom middleware for auth (works but different)
  • Reference updates 4 files with error handling → Candidate updates 3 of 4 files (missing one)
  • Reference adds CLI flag --config using commander → Candidate adds --config using yargs (different library, same outcome)
  • Reference refactors 5 functions to async/await → Candidate refactors 3 of 5 (partial completion)

0.25 - Partial Implementation
- Only a fraction of requirements met (<50%)
- Missing major edits or files
- Significant deviations: different CLI commands, altered workflows, major logic changes
- Some core functionality absent
Examples:
  • Reference updates 6 files, adds API endpoints, updates README with 4 commands → Candidate updates 2 files, adds 1 endpoint, README unchanged
  • Reference migrates from REST to GraphQL (10 files) → Candidate converts only 2 of 10 files
  • Reference: npx @slicemachine/init@latest --starter course-fizzi-next → Candidate uses npx prismicio@latest init (different workflow)
  • Reference adds database.connect() with pooling → Candidate keeps old connection, adds unrelated logging

0.0 - Failed/Wrong
- Required changes missing or reversed
- Wrong files modified
- Replaced with incompatible alternative workflows
- Added logic that changes behavior incorrectly
Examples:
  • Reference removes deprecated oldMethod() → Candidate keeps oldMethod()
  • Reference updates 5 specific files → Candidate updates 5 different unrelated files
  • Reference fixes bug by adding null check → Candidate removes the code entirely
  • Reference adds feature X → Candidate makes no changes or unrelated changes

Checklist:
1. Files touched: the same files must be modified or deleted.
2. README/docs: CLI commands, setup steps, filenames, and flags must match. Changing the tooling is a major deviation (0.25 or lower).
3. Code paths/APIs: functions must call the same APIs with the same arguments. Using a different API is a major deviation (0.5 or lower).
4. Extra logic: additional helper functions or refactors are acceptable only if they are behaviour-neutral. Extensive rewrites should lower the score.
5. Documentation tone/phrasing: ignore stylistic differences so long as the sequence of steps, commands, and key facts is identical. Only penalize when instructions or tooling differ.
6. Minimal change preference: prefer implementations that stick closely to the reference structure; penalize expansive rewrites.

Return JSON with 'score' (must be exactly one of: 0, 0.25, 0.5, 0.75, 1.0) and a concise rationale that cites the key matches and deviations.`;

export default createScore({
  prepare: async ({ evaluation }) => {
    try {
      const diff = await fetchComparisonDiff(evaluation);

      assert(
        diff.trim().length > 0,
        `Semantic similarity score requires a non-empty reference diff for ${evaluation.repo}.`,
      );

      return diff;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Semantic similarity reference diff preparation failed: ${message}`,
      );
    }
  },
  evaluate: async ({ evaluation, cwd, judge, reference }) => {
    finalizeAgentChanges(evaluation, cwd, evaluation.from);
    let candidateDiff: string;
    try {
      candidateDiff = execSync(
        `git diff --unified=5 ${evaluation.from} HEAD`,
        {
          cwd,
          encoding: "utf8",
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Semantic similarity candidate diff generation failed: ${message}`,
      };
    }

    assert(
      typeof candidateDiff === "string" && candidateDiff.trim().length > 0,
      "Semantic similarity score requires a diff to compare.",
    );
    assert(
      typeof reference === "string" && reference.length > 0,
      "Semantic similarity score requires a reference diff to compare against.",
    );

    try {
      const { object } = await generateObject({
        model: judge.model,
        schema: scoreResultSchema,
        system: systemPrompt,
        temperature: 0,
        prompt: `Reference diff:\n${reference}\n\nCandidate diff:\n${candidateDiff}\n\nCompare the candidate changes against the reference expectations and respond with JSON.`,
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        rationale: `Semantic similarity evaluation failed: ${message}`,
      };
    }
  },
});
