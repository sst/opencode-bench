> opencode bench
```bash
orvl opencode # run opencode on all models x evals x scores
orvl opencode --model opencode/qwen3-coder # filter by model across all evals x scores
orvl opencode --eval noworneverev/graphrag-visualizer # filter by eval across models x scores
```

Filters use CLI options like `--model`, `--eval`, and `--score`.

## Setup
```bash
bun install
bun run build
```

During development the CLI can be executed directly with Bun:

```bash
bun run dev -- <agent> [--model <model>] [--eval <owner/name>] [--score <score>]
```

## Continuous Releases
Install the [pkg.pr.new GitHub App](https://github.com/apps/pkg-pr-new) on your repository to enable preview packages for every push or pull request. The workflow in `.github/workflows/pkg-pr-new.yml` installs dependencies with Bun, builds the project, and runs `bunx pkg-pr-new publish` to publish previews automatically.

## Scores
a score is a function that returns a score (0 to 1).

`scores/ui.ts`
```typescript
export default createScore(() => {
	// here's where the judge would operate and give a score
	// ...
	return {
		score: 0.43,
		rationale: "Baseline UI rationale"
	}
})
```

## TODO
- [ ] Stabilize scoring by replacing flaky LLM judges for logic-equivalence, integration-points, test-coverage, and checks with deterministic analysis (see `benchmark-observations.md` for details).

`scores/code-quality.ts`
```typescript
export default createScore(() => {
	// ...
	return {
		score: 0.12,
		rationale: "Baseline code quality rationale"
	}
})
```

// --- setup --------------------------------------------------

// Assessors and their weights
const assessors = ["Claude", "GPT", "Kimi"];
const w = [0.5, 0.3, 0.2]; // must sum to 1

// Score types and their weights
const scoreTypes = ["readability", "cases", "bugs"];
const v = [0.4, 0.3, 0.3]; // must sum to 1

// Scores matrix S[i][j] = score from assessor i on score type j
const S = [
  [0.80, 0.60, 0.70], // Claude
  [0.90, 0.70, 0.60], // GPT
  [0.70, 0.50, 0.80], // Kimi
];

// --- functions ---------------------------------------------

// weighted mean for a single score type j
function meanForScoreType(j) {
  return S.reduce((acc, row, i) => acc + w[i] * row[j], 0);
}

// weighted variance for a single score type j
function varianceForScoreType(j) {
  const mean = meanForScoreType(j);
  return S.reduce((acc, row, i) => acc + w[i] * (row[j] - mean) ** 2, 0);
}

// --- compute ------------------------------------------------

const means = scoreTypes.map((_, j) => meanForScoreType(j));
const R = scoreTypes.reduce((acc, _, j) => acc + v[j] * means[j], 0);

// disagreement penalty
const variances = scoreTypes.map((_, j) => varianceForScoreType(j));
const lambda = 0.5;
const R_pen = R - lambda * variances.reduce((acc, varj, j) => acc + v[j] * varj, 0);

// --- output -------------------------------------------------
console.log("Per-score-type means:", means);
console.log("Overall R:", R.toFixed(3));
console.log("Per-score-type variances:", variances);
console.log("Penalized R_pen:", R_pen.toFixed(3));
```

```
Per-score-type means: [ 0.81, 0.61, 0.69 ]
Overall R: 0.714
Per-score-type variances: [ 0.005, 0.005, 0.005 ]
Penalized R_pen: 0.712
```


#### Judges
Potential scores across three judges.

- UI
- functionality (computer-use models? playwright access?)
- UX (similar to functionality)
- code readability
- adherence to best practices and project configs
	- respecting AGENTS.md, CLAUDE.md, ...
	- `.eslintrc` / `.prettierrc` / ...
- token consumption, speed, tool calls number
	- do we incentivize everyone to do less tool calls? or more? maybe we should remove it, just a thought.
	- the less tokens and the faster the agent is, the better.
	- this score does not need an LLM judge.

## Agents

`agents/opencode.ts`
```typescript
export const models = ["openai/gpt-4o", "anthropic/claude-sonnet-4"] // useful for assertions and matrix testing

export default createAgent((model, prompt) => {
	void prompt
	return `opencode run -m ${model}`
})
```

### Dummy agents

To test out the the benchmark itself, we can have a dummy agent that we measure how the judges behave on those dummy outputs.

`agents/dummy-bad.ts`
```typescript
export const models = ["openai/gpt-4o", "anthropic/claude-sonnet-4"] // useful for assertions and matrix testing

export default createAgent((model, prompt) => {
	// fs.writeFile to write dummy files
	return `echo ...`
})
```

the variance between this dummy and `agents/dummy-good.ts` should be high to validate that the judges produce _fair_ scores.

## Scoring Methodology

All current scores are produced by LLM judges (`claude-4.5`, `gpt-5-codex`, `kimi`). For each assignment we gather their outputs into a matrix \(S \in [0,1]^{m \times k}\), where rows index judges and columns index score types. Given judge weights \(w \in \Delta^{m-1}\) (currently uniform) and assignment weights \(v \in \Delta^{k-1}\), the base score is

\[
R = v^\top S^\top w = \sum_{j=1}^k v_j \left( \sum_{i=1}^m w_i s_{ij} \right).
\]

To discourage disagreement we subtract a variance penalty (see `lib/utils/scoreAggregation.ts`):

\[
R_{\text{pen}} = R - \lambda \sum_{j=1}^k v_j \operatorname{Var}_j, \qquad \operatorname{Var}_j = \sum_{i=1}^m w_i (s_{ij} - \bar{s}_j)^2, \quad \bar{s}_j = \sum_{i=1}^m w_i s_{ij}.
\]

The tests in `tests/scoreAggregation.test.ts` exercise this aggregation. The TODO above tracks the plan to replace noisy LLM scorers with deterministic checks while keeping the same aggregation pipeline.


  rank  repo                                      stars  forks
  1     noworneverev/graphrag-visualizer           375     46
  2     KwokKwok/Silo                              240     25
  3     prismicio-community/course-fizzi-next      180     77
  4     mylofi/local-vault                         118      3
  5     Rasalas/msg-reader                          74     14
  6     halitsever/nest-cloudflare-turnstile        62     16
  7     psyko-gh/overcrawlrr                        60      1
  8     googleworkspace/drive-picker-element        46      6
  9     pbstar/fitview                              37      0
  10    ekoln/nextdaily                             33     20

  Forks Leaderboard

  rank  repo                                      stars  forks
  1     prismicio-community/course-fizzi-next      180     77
  2     noworneverev/graphrag-visualizer           375     46
  3     KwokKwok/Silo                              240     25
  4     Cefalo/quick-meet                           32     22
  5     ekoln/nextdaily                             33     20
  6     halitsever/nest-cloudflare-turnstile        62     16
  7     BhuwanSKumar/refrain-addiction-main         11     16
  8     Rasalas/msg-reader                          74     14
  9     AlaminPu1007/algorithm-visualizer           22      7
  10    mohitchandel/AI-APP-Template                12      7
