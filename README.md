> open real evals
```bash
orvl opencode # running opencode on all models x providers x evals x metrics
orvl opencode qwen3-coder # running opencode with qwen3-coder on all providers x evals x metrics
orvl opencode qwen3-coder zen # running opencode with qwen3-coder on zen with all evals x metrics
orvl opencode qwen3-coder zen hello-world # running opencode with qwen3-coder on zen the hello-world eval with all metrics
orvl opencode qwen3-coder zen hello-world semantic-similarity # running opencode with qwen3-coder on zen the hello-world eval with all metrics
```

or we can go the `--model= --provider= --eval=` way.
## Scores
a score is a function that returns a score (0 to 1).

`scores/ui.ts`
```typescript
export default createScore(() => { 
	// here's where the judge would operate and give a score
	// ...
	return 0.43 
})
```

`scores/code-quality.ts`
```typescript
export default createScore(() => { 
	// ...
	return 0.12
})
```

`scores/semantic-similarity.ts`
```typescript
export default createScore(() => { 
	// ...
	return 0.97
})
```

### Semantic Similarity 
Semantic Similarity would be an ideal solution, but it assumes the existence of canonical output which is hard to create and identify. Huge part of that quality idealism is subjective. What's ideal for us is not ideal for others.   

We should either come up with a standard that allows us to produce code according to those standards and best-practices to have a baseline. Or we ignore the semantic similarity, at least for most samples, to tailor that analysis to certain functions, hooks and modules.   

Another idea just popped to my mind this morning. 

Instead of ideal code, we can have a judge LLM create a project, generate rules based on the generated output, and then pass around those rules or descriptions to the agent and measure the relevance between the original generated code by the judge and the newly generated code by the agent with semantic similarity.

### LLM Evaluation

LLM evaluation seems like a simpler solution, three critiques (e.g. Claude 4.5, GPT-5-codex, ...) that rate code readability, missing cases and potential bugs. 

the equation $R=v^\top S^\top w$ produces the rates. more details in the section below. 

Gosu avoids sharing the benchmarks publicly because that'd potentially have labs train their models on those benchmarks. Inspired by that, we can avoid writing any canonical sample in the first place, by just having a series of prompts (that resembles the conversationalist user, rather than a one shot usage) and few LLM judges that rate the generated response.  

Therefore, no project would be stored in the dataset, but rather, the prompt to generate it would be there. This creates a non-deterministic benchmarks which are hard to predict which corresponds to the real world where there is no single _perfect_ or _ideal_ project that acts as a role model. 

This is non-deterministic and the way to reduce from that behavior is to produce few dummy agents and dummy outputs as explained below.  

#### The Rating Equation

$\underset{\text{scores table}} {S \in [0,1]^{m \times k}}, \underset{\text{model weights}} {w \in \Delta^{m-1}},\underset{\text{the metrics weights array}} {v \in \Delta^{k-1}} \to \underset{\text{rate}} R=v^\top S^\top w$

The model weights are likely to be equal since we assume those selected judge models are intelligent _enough_ equally.  

But the metrics weights should resemble our own priorities and what the benchmark cares about the most, whether we value UI beauty more, code correctness or any other metric.   

We can as well add a disagreement penalty to avoid the high variance across models to stabilize the final rate.

$R_{pen}= R - \lambda\sum_{j} v_{j} {Var}_{j}$

$\underset{\text{seriousness of the penalty}} {\lambda \geq 0}$
${Var}_{j} = \sum_{i} w_{i} {(s_{ij} - \bar{s_{j}} )}^2$
$\bar{s_{j}}=\sum_{i} w_{i} s_{ij}$

After observing the spectrum of each judge's rating in the future, we can add calibration to account for how harsh or generous a model is.  

here's an ai generated sample code for the rating mechanism. 

```javascript
// --- setup --------------------------------------------------

// Assessors and their weights
const assessors = ["Claude", "GPT", "Kimi"];
const w = [0.5, 0.3, 0.2]; // must sum to 1

// Metrics and their weights
const metrics = ["readability", "cases", "bugs"];
const v = [0.4, 0.3, 0.3]; // must sum to 1

// Scores matrix S[i][j] = score from assessor i on metric j
const S = [
  [0.80, 0.60, 0.70], // Claude
  [0.90, 0.70, 0.60], // GPT
  [0.70, 0.50, 0.80], // Kimi
];

// --- functions ---------------------------------------------

// weighted mean for a single metric j
function meanForMetric(j) {
  return S.reduce((acc, row, i) => acc + w[i] * row[j], 0);
}

// weighted variance for a single metric j
function varianceForMetric(j) {
  const mean = meanForMetric(j);
  return S.reduce((acc, row, i) => acc + w[i] * (row[j] - mean) ** 2, 0);
}

// --- compute ------------------------------------------------

const means = metrics.map((_, j) => meanForMetric(j));
const R = metrics.reduce((acc, _, j) => acc + v[j] * means[j], 0);

// disagreement penalty
const variances = metrics.map((_, j) => varianceForMetric(j));
const lambda = 0.5;
const R_pen = R - lambda * variances.reduce((acc, varj, j) => acc + v[j] * varj, 0);

// --- output -------------------------------------------------
console.log("Per-metric means:", means);
console.log("Overall R:", R.toFixed(3));
console.log("Per-metric variances:", variances);
console.log("Penalized R_pen:", R_pen.toFixed(3));
```

```
Per-metric means: [ 0.81, 0.61, 0.69 ]
Overall R: 0.714
Per-metric variances: [ 0.005, 0.005, 0.005 ]
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
	- this score/metric does not need an LLM judge. 

## Agents

`agents/opencode.ts`
```typescript
export const models = {
	"openai": ["gpt-4o"],
	"anthropic": ["claude-sonnet-4"]
} // useful for assertions and matrix testing  

export default createAgent((provider, model, prompt) => {
	return `opencode run -m ${provider}-${model} ${prompt}`
})
```

### Dummy agents

To test out the the benchmark itself, we can have a dummy agent that we measure how the judges behave on those dummy outputs.

`agents/dummy-bad.ts`
```typescript
export const models = {
	"openai": ["gpt-4o"],
	"anthropic": ["claude-sonnet-4"]
} // useful for assertions and matrix testing  

export default createAgent((provider, model, prompt) => {
	// fs.writeFile to write dummy files	
	return `echo ...`
})
```

the variance between this dummy and `agents/dummy-good.ts` should be high to validate that the judges produce _fair_ scores. 
