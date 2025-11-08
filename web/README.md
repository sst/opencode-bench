each commit in the `main` on this repo triggers a benchmark execution. each benchmark execution runs few `${agent}:${provider?}/${model}` combinations.

the current combinations:
```
opencode:opencode/gpt-5-codex
opencode:opencode/claude-sonnet-4-5
opencode:opencode/big-pickle
opencode:opencode/glm-4.6
claude-code:claude-sonnet-4-5
codex:gpt-5-codex
```

the list is dynamic and new combinations can be added to it.

each of the combinations is measured across a handful of evals, currently 3, short-term goal is 25 and the long-term goal is 100 afaik. each eval consists of a mainstream github repo, a `from` commit that the agent starts with, a `to` commit that it should replicate but it does not know about, and few scores that measure how well did the agent replicate `to` commit.

for example, the `api-signature` measures the combination's performmance in replicating the same architectural patterns that is apparent across the eval and specifically across the `to` commit diff. each score has 3 judges (claude sonnet, gpt-5-codex and kimi k2) that each rate by the binary decision 0 (FAIL) or 1 (PASS) and by aggregating all rates together, we produce a number fluid between 0 to 1. each judge produces a rationale as well. we also have an overall summary of an analysis over the rationales.
each score has its own description that should be shown to the user seeing it.

the `weight` captures the score's importance in the final score. the list of scores is dynamic as well. each eval might have a different list of scores compared to another eval.

```yaml
- repo: DataDog/datadog-lambda-python
  from: 93d4a07fa61a4d4d2feec08e722505a9e0cc8657
  to: d7763789f262b2da228f8210509e302e6e510d0a
  prompts: prompts/datadog-lambda-python.yaml
  issues: []
  scores:
    api-signature:
      weight: 0.2
    logic-equivalence:
      weight: 0.3
    integration-points:
      weight: 0.2
    test-coverage:
      weight: 0.2
    checks:
      weight: 0.1
      args:
        setup:
          - python3 -m venv .venv
          - ./.venv/bin/python -m pip install ".[dev]"
        commands:
          - ./.venv/bin/pytest -vv
          - ./.venv/bin/flake8 datadog_lambda/
```

any commit between `from` (exclusive) and `to` (inclusive) has a specific prompt (task) that the agent should act on. these prompts might change on a monthly basis by a maintainer so we avoid making the benchmarks too deterministic. the prompts change slightly so this does not make old benchmarks incomparable to the new benchmarks even though that's not the goal of OpenCode-bench because with this benchmark we're trying to compare agents & models to each other.

```yaml
generated_at: 2025-11-04T01:45:24.286Z
prompts:
  - commit: d7763789f262b2da228f8210509e302e6e510d0a
    prompt: "Add a metric to track Lambda batch item failures. When Lambda functions return a response containing batch item failures (the batchItemFailures field), emit a count of how many items failed as an enhanced metric. This should only happen when enhanced metrics are enabled and the response structure is valid (response is a dict and batchItemFailures is a list). The metric should be submitted asynchronously with enhanced metrics tags. Integrate this into the wrapper's after-execution hook so it automatically captures the response from any wrapped Lambda handler. Follow existing codebase patterns for function signatures and integration points. Include comprehensive test coverage for various scenarios: responses with multiple failures, empty failure lists, missing batchItemFailures field, None responses, invalid field types, and disabled enhanced metrics. Also add integration tests in the wrapper test suite to verify the metric submission is called with the correct response object."
```

that's a general flow of how the benchmarking system works under the hood.

---

now let's jump into what the UI might need to show to the user.

since each commit has a benchmark execution with it, we let the user navigate between commit (we might want to show the date of each of those commits, but the commit hash looks cooler) and see the associated run. each of those runs has enough information about each agent and model across each eval.

by default, the last run is shown on the home page as the main information. but that can change through navigating the commit history to show the benchmarks of a 1 month old run for instance.

each run shows a per agent and a per model comparison/chart is formed by aggregating the scores of each combination per eval. so the user is able to see more specific information that is specific to a single eval.

we store a per agent:model analysis summary as well that talks about how that agent behaved in a specific run. there's also a difference analysis summary that is per eval, which talks about how different agents/models behvaed in that eval.

[scatter charts](https://recharts.github.io/en-US/examples/SimpleScatterChart/) are often used to demonstrate the performace of AI models compared to each other.

we can use [radar charts](https://recharts.github.io/en-US/examples/SimpleRadarChart/) to show the scores (e.g. `api-signature`) of a specific agent:model combination.

we can draw a difficulty line based on the 70th percentile to differentiate between top and average agents & models.

across the history of benchmark runs, the difficulty line (vertical) can be a chart as well to demonstrate the volatility of the difficulty run. the more time passes, difficulty decreases since models get better over time, but by adding and adjusting evals, we can keep the difficulty high. that's kinda the point of having a difficulty chart.

### error-analysis

https://www.youtube.com/watch?v=e2i6JbU2R-s
https://hamel.dev/blog/posts/field-guide/index.html

the community should help us carry out error analysis to improve the task generation capability (e.g. how much do those generated tasks resemble real-world user prompting) and the accuracy of the judges (e.g. catch the strong inconsistency between the judges). they should be able to see each task that led the agent to reproduce a specific diff, compare it to the ideal original diff (extracted from the evals the community gifts us) and see the judges response to that.

this way (hopefully through the ui) they can suggest us improvments, or whether they think a judge output was too strict or lean or even prompt changes to the way judges behave or the way our planner generates tasks.

basically, wherever we have an LLM as judge or a part of our workflow that relies on an LLM, we need a detailed error analysis process so we keep improving these non-deterministic parts of our workflow. most ai benchmarks get outdated or do not represent real-world difficulty because they're not monitored which makes them irrelevant after a small portion of time.

error-analysis can be as simple as like and dislike buttons and a small input box for explanation. that would be ideally shown on each prompt and and its output.

- each judge's prompt and its rating and rationale
- the task generation prompt and its generated tasks.

the goal is to constantly verify that our automated evaluations (LLM-as-a-judge) align with human judgement.

## Error Analysis Implementation

We have four LLM-powered components that require community error analysis:

### 1. Task Generation (Planner)
Location: Converts git diffs into agent prompts
Model: `opencode/claude-sonnet-4-5`

UI Should Show:
- Original commit diff (truncated for readability)
- Generated task prompt
- The actual changes the agent produced

Feedback Collection:
- Binary: "Does this prompt capture the commit's intent?" [Yes/No]
- Multiple choice: "This prompt is: [Too vague | Too specific | Just right | Missing context]"
- Text input: "How would you improve this prompt?"

### 2. Score Judges (15 total: 5 score types × 3 judges)
Judges: claude-4.5, gpt-5-codex, kimi
Score Types: api-signature, logic-equivalence, integration-points, test-coverage, checks

UI Should Show:
- Episode selector: Toggle between Episode 0, 1, 2 (judges evaluate each independently)
- Reference diff (expected changes)
- Candidate diff (agent's actual changes for this episode)
- Judge's system prompt (scoring criteria)
- All 3 judges side-by-side, always showing:
  - Judge name and model
  - Score (0 or 1) for this episode
  - Full rationale (200-1000 words with code analysis) for this episode
- Episode variance indicator (shows consistency across episodes)

Feedback Collection:
- Binary per judge: "Do you agree with this judge's decision?" [Agree/Disagree/Unsure]
- If disagree: "What did the judge get wrong?" (text input)
- Rating per judge: "This judge was: [Too strict | Just right | Too lenient]"
- Flag: "These judges are inconsistent" (when variance is high within an episode)
- Flag: "This episode is an outlier" (when one episode diverges significantly from the other two)

Design Note:
- Always display all 3 judges' rationales side-by-side for the selected episode to make inconsistencies obvious. Highlight when variance > 0.15.
- When episode scores vary significantly (e.g., Episode 0: 0.5, Episode 1: 0.2, Episode 2: 0.3), allow comparing the same judge's rationale across episodes to understand why scores changed.

### 3. Agent Behavior Summarizer
Location: Summarizes agent's actions across 3 episodes
Model: `opencode/claude-sonnet-4-5`

UI Should Show:
- Raw action logs per episode (first 50 actions, expandable)
- Generated summary (200-500 words)
- Final scores for context

Feedback Collection:
- Rating: "Is this summary accurate?" [Very | Mostly | Partially | Not at all]
- Text input: "What's missing from this summary?"
- Text input: "Did the summary claim something that didn't happen?"

### 4. Cross-Agent Analysis
Location: Compares all agent:model combinations on same eval
Model: `opencode/claude-sonnet-4-5`

UI Should Show:
- All runs' scores and summaries (the input data)
- Generated comparative analysis (1000+ words)

Feedback Collection:
- Rating: "Is this analysis insightful?" [Very | Somewhat | Not really | No]
- Text input: "What pattern did the analysis miss?"
- Binary: "Are the recommendations actionable?" [Yes/Somewhat/No]

## Error Analysis Data Structure

Store feedback alongside benchmark results:

```typescript
interface ErrorAnalysisFeedback {
  feedbackId: string;
  timestamp: string;
  userId?: string; // Optional: track who provided feedback

  // Component identification
  componentType: "planner" | "judge" | "agent-summary" | "cross-analysis";
  componentId: string; // e.g., "api-signature:claude-4.5" or "planner:abc123"

  // Structured responses
  rating?: "agree" | "disagree" | "unsure" | number;
  category?: string; // Multiple choice responses
  comment?: string; // Free text

  // Context for aggregation
  evalRepo: string;
  benchmarkCommit: string;
  agentModel?: string; // If applicable to specific run
}
```

## Aggregation Dashboard

Create a monitoring dashboard showing:
- Judge Consistency: % of human agreement per judge per score type
- High-Variance Issues: Evals where judges disagree + humans flag inconsistencies
- Planner Quality: % of tasks rated "too vague" or "too specific"
- Summary Accuracy: % of summaries rated "mostly" or "very" accurate
- Trending Issues: Patterns in feedback over time

---

## Data Structure Reference

This section documents the exact data fields available for each agent:model:eval combination. Use this as a reference when designing UI components.

### Top-Level Run Information
Each benchmark run contains:
- agent: Agent type (e.g., "claude-code", "opencode", "codex")
- model: Model identifier (e.g., "claude-sonnet-4-5", "gpt-5-codex", "big-pickle")
- evaluation: Object with:
  - `repo`: GitHub repository (e.g., "DataDog/datadog-lambda-python")
  - `from`: Starting commit hash
  - `to`: Target commit hash the agent attempts to replicate

### Scoring Metrics
- finalScore: Final weighted score after penalties (0-1 scale, e.g., 0.32469)
- baseScore: Raw weighted average before penalties (0-1 scale, e.g., 0.36667)
- variancePenalty: Penalty for inconsistent judge performance (e.g., 0.04198)

### Per-Score Breakdown
For each score dimension (api-signature, logic-equivalence, integration-points, test-coverage, checks):

- assignment:
  - `name`: Score type identifier (e.g., "api-signature")
  - `weight`: Importance weight (e.g., 0.2 = 20%)
  - `args`: (Optional) Configuration for executable checks:
    - `setup`: Array of setup commands
    - `commands`: Array of test commands to run

- averageScore: Mean score across all judges (0-1 scale)
- normalizedWeight: Weight after normalization (typically same as original)
- variance: Statistical variance in judge scores (higher = more disagreement among judges)

- judges: Array of individual judge evaluations:
  - `name`: Judge identifier (e.g., "claude-4.5", "gpt-5-codex", "kimi")
  - `model`: Full model path (e.g., "opencode/claude-sonnet-4-5")
  - `score`: Binary rating (0 = FAIL, 1 = PASS)
  - `rationale`: Full text explanation (typically 200-1000 words with code examples, diffs, and detailed technical analysis)

### Analysis Summaries

Per Agent:Model Summary (stored in benchmark's `summary` field):
- Multi-paragraph markdown text (typically 200-500 words)
- Describes agent behavior across episodes
- Common sections: "Overview", "Approach", "Key Actions", "Observations"
- Highlights patterns like tool usage, exploration strategies, consistency

Per Eval Cross-Agent Analysis (stored in `analysis-{safe-repo-name}/analysis.txt`):
- Comprehensive comparison document (1000+ words)
- Compares all agent:model combinations on the same eval
- Example sections:
  - "Executive Summary"
  - "Systematic Performance Patterns" (tier separation, penalty analysis)
  - "Implementation Quality Differences"
  - "Testing Strategy Divergence"
  - "Agent Behavioral Tendencies"
- Includes comparison tables and detailed insights

Analysis Metadata (in `analysis-{safe-repo-name}/analysis-info.json`):
- `eval`: Repository name
- `safe`: URL-safe repository name
- `url`: Link to GitHub Actions run that generated the analysis

### Run Metadata (in `metadata.json`)
Each benchmark run includes:
- commit: Git commit hash of the benchmark run
- workflowRun: GitHub Actions workflow details:
  - `id`: Workflow run ID
  - `name`: Workflow name (e.g., "Publish and Benchmark Preview Packages")
  - `status`: "completed", "in_progress", etc.
  - `conclusion`: "success", "failure", etc.
  - `createdAt`: ISO timestamp
- artifacts: Array of generated benchmark/analysis artifacts:
  - `name`: Artifact identifier (pattern: `benchmark-{agent}-{model}-{safe-repo-name}` or `analysis-{safe-repo-name}`)
  - `size`: File size in bytes
  - `createdAt`: ISO timestamp
  - `expired`: Boolean

### Episode-Specific Data
Each benchmark run executes 3 episodes (independent attempts at the same task). This helps measure consistency and identify variance in agent behavior.

episodes: Array of 3 episode objects, each containing:
- finalScore: Episode-specific final score (0-1 scale)
- baseScore: Episode-specific base score before penalties
- variancePenalty: Penalty applied for this episode
- usage: Token usage for this episode:
  - `input`: Input tokens consumed
  - `output`: Output tokens generated
- scores: Full score breakdown identical to the run-level structure:
  - Each score dimension (api-signature, logic-equivalence, etc.) with:
    - `assignment`: Score name, weight, args
    - `averageScore`: Mean judge score for this episode
    - `variance`: Judge disagreement variance for this episode
    - `judges`: Array of 3 judge evaluations (name, model, score, rationale)

Key Insight: Episode-level scores can vary significantly. For example:
- Episode 0: finalScore = 0.500
- Episode 1: finalScore = 0.211
- Episode 2: finalScore = 0.322

This variance reveals agent consistency issues and is critical for understanding reliability.

### Aggregate-Level Data
- usage: Aggregated token usage across all episodes:
  - `input`: Total input tokens
  - `output`: Total output tokens

### Important Design Considerations

1. Judge rationales are substantial - Not one-liners; they're detailed technical analyses with code snippets, sometimes 500+ words each. Design for expandable/collapsible detailed views.

2. Data is hierarchical - Run → Eval → Scores → Judges. Navigation should reflect this hierarchy clearly.

3. Two types of summaries exist:
   - Agent-specific: "How did this agent:model perform on this eval?"
   - Cross-agent: "How did all agents compare on this specific eval?"

4. Multiple commits = multiple snapshots - Each commit has its own `metadata.json` with different artifact lists. Design for temporal navigation between these snapshots.

5. Scores are multi-dimensional and variable - Each eval can have different score types with different weights. One eval might have 5 scores, another might have 3. Radar charts should handle variable dimensions.

6. Variance is meaningful - High variance indicates judge disagreement. Surface this visually as it signals potential evaluation issues or edge cases.

7. Episodes reveal consistency patterns - Each run has 3 independent episodes with separate scores and judge rationales. Design for:
   - Episode-by-episode comparison views (show all 3 side-by-side)
   - Variance visualization across episodes (e.g., bar chart showing episode scores)
   - Episode-specific judge rationales (judges evaluate each episode independently, so rationales differ per episode)
   - Identifying which episodes succeeded vs failed and why
