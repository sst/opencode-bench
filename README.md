# OpenCode Bench

A rigorous benchmarking framework for evaluating AI coding agents on real-world GitHub repositories. OpenCode Bench runs agents against production code changes and scores their outputs using multiple LLM judges across five key dimensions: API signature compliance, logic equivalence, integration correctness, test coverage, and project checks.

## Key Features

- **Multi-Judge Evaluation** - Three independent LLM judges score each submission with variance penalties for disagreement
- **Real-World Scenarios** - Evaluations based on actual production commits from open-source repositories
- **Episode Isolation** - Three isolated runs per evaluation with fresh repository clones for statistical reliability
- **Multi-Dimensional Scoring** - Five weighted score types measuring different aspects of code quality
- **Mathematical Rigor** - Weighted aggregation with variance penalties ensures consistent, fair scoring

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.2.21+)
- API keys for the agents you want to test:
  - `OPENCODE_API_KEY` for OpenCode agents
  - `OPENAI_API_KEY` for Codex agents
  - `ANTHROPIC_API_KEY` for Claude Code agents

### Installation

```bash
bun install
bun run build
```

### Basic Usage

Run a benchmark evaluation:

```bash
orvl opencode --model opencode/claude-sonnet-4-5 --eval DataDog/datadog-lambda-python
```

Export results to JSON:

```bash
orvl opencode --model opencode/gpt-5-codex --eval DataDog/datadog-lambda-python --output results.json
```

Both `--model` and `--eval` are required. Each invocation executes three isolated episodes (fresh clones) and aggregates the judge scores before exporting results.

### Development Mode

During development, run the CLI directly with Bun:

```bash
bun run dev -- opencode --model opencode/claude-sonnet-4-5 --eval <owner/repo>
```

## How It Works

OpenCode Bench evaluates AI coding agents by:

1. **Selecting a baseline** - Checking out a repository at a specific commit
2. **Generating a task** - Creating a prompt from a later production commit
3. **Running the agent** - Executing the AI agent with a 30-minute timeout
4. **Comparing outputs** - Diffing the agent's changes against the actual production code
5. **Multi-judge scoring** - Three LLM judges evaluate across five dimensions
6. **Aggregating results** - Computing weighted scores with variance penalties

Each evaluation runs three isolated episodes to ensure statistical reliability. Episodes use fresh repository clones and independent judge assessments.

## Scoring Methodology

### Score Dimensions

Each submission is evaluated across five weighted dimensions:

- **API Signature** (20%) - Function signatures match expected interfaces
- **Logic Equivalence** (30%) - Conditional logic produces equivalent outcomes
- **Integration Points** (20%) - External calls maintain correct order and arguments
- **Test Coverage** (20%) - Adequate test coverage and quality
- **Checks** (10%) - Passes linting, tests, and build processes

Weights are configurable per evaluation in `dataset.yaml`.

### Mathematical Formulation

Scores are aggregated using a weighted variance-penalized approach. For a matrix S ∈ [0,1]^(m×k) where rows index judges and columns index score types, with judge weights w ∈ Δ^(m-1) and score weights v ∈ Δ^(k-1), the base score is:

```
R = v^T S^T w = Σ(j=1 to k) v_j ( Σ(i=1 to m) w_i s_ij )
```

To discourage judge disagreement, a variance penalty is applied:

```
R_pen = R - λ Σ(j=1 to k) v_j Var_j

where:
  Var_j = Σ(i=1 to m) w_i (s_ij - s̄_j)²
  s̄_j = Σ(i=1 to m) w_i s_ij
  λ = 0.5 (disagreement penalty coefficient)
```

Implementation details are in `lib/utils/scoreAggregation.ts` and tested in `tests/scoreAggregation.test.ts`.

### Judges

Currently uses three LLM judges with equal weighting:
- **claude-4.5** (Claude Sonnet 4.5 via Anthropic)
- **gpt-5-codex** (GPT-5 Codex via OpenAI)
- **kimi** (Kimi-k2 via Moonshot)

All judges use "Zen" model variants optimized for code evaluation.

## Development

### Building

```bash
bun run build
```

This compiles `cli.ts` to `dist/cli.js` with all necessary externals.

### Testing

Run the full test suite:

```bash
bun test
```

Test judge consistency:

```bash
bun run test:consistency
```

Test score aggregation:

```bash
bun test tests/scoreAggregation.test.ts
```

### Project Structure

```
agents/          # Agent integrations (OpenCode, Codex, Claude Code)
scores/          # Score dimension implementations
prompts/         # Task definitions per evaluation (YAML)
lib/             # Core framework utilities
tests/           # Test suite
dataset.yaml     # Evaluation definitions
cli.ts           # Main CLI orchestrator
```

### Continuous Integration

The project uses GitHub Actions for CI/CD with automated benchmark publishing. Preview packages are published on every push via [pkg.pr.new](https://github.com/apps/pkg-pr-new).

## Contributing

Contributions are welcome! Key areas for improvement:

- Complementing LLM judges with deterministic analysis for improved stability (see `benchmark-observations.md`)
- Adding new evaluation datasets from real-world repositories
- Adding support for additional AI coding agents

## Resources

- **Detailed Observations** - See `benchmark-observations.md` for analysis of scoring stability and improvement suggestions
- **Research Notes** - See `notes.md` for methodology discussions and validation approaches
