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

any commit between `from` (exclusive) and `to` (inclusive) has a specific prompt (task) that the agent should act on. these prompts might change on a month to month basis by a maintainer so we avoid making the benchmarks too deterministic. the prompts change slightly so this does not make old benchmarks incomparable to the new benchmarks even though that's not the goal of OpenCode-bench because with this benchmark we're trying to compare agents & models to each other.

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
