# Benchmark Data

This directory contains artifacts fetched from GitHub Actions workflows.

## Current Data

**Commit**: `ea446df3c3284cf6be379486a9807d0c48ef7d78`  
**Workflow Run**: `19057352801` - "Publish and Benchmark Preview Packages"  
**Fetched**: See `metadata.json` for details

## Artifacts Found

### Benchmark Artifacts (12)
- `benchmark-opencode-opencode-claude-sonnet-4-5-prismicio-community-course-fizzi-next`
- `benchmark-opencode-opencode-big-pickle-prismicio-community-course-fizzi-next`
- `benchmark-claude-code-claude-sonnet-4-5-prismicio-community-course-fizzi-next`
- `benchmark-opencode-opencode-claude-sonnet-4-5-AlaminPu1007-algorithm-visualizer`
- `benchmark-opencode-opencode-claude-sonnet-4-5-DataDog-datadog-lambda-python`
- `benchmark-claude-code-claude-sonnet-4-5-DataDog-datadog-lambda-python`
- `benchmark-claude-code-claude-sonnet-4-5-AlaminPu1007-algorithm-visualizer`
- `benchmark-codex-gpt-5-codex-prismicio-community-course-fizzi-next`
- `benchmark-opencode-opencode-big-pickle-DataDog-datadog-lambda-python`
- `benchmark-codex-gpt-5-codex-AlaminPu1007-algorithm-visualizer`
- `benchmark-codex-gpt-5-codex-DataDog-datadog-lambda-python`
- `benchmark-opencode-opencode-big-pickle-AlaminPu1007-algorithm-visualizer`

### Analysis Artifacts (3)
- `analysis-AlaminPu1007-algorithm-visualizer`
- `analysis-prismicio-community-course-fizzi-next`
- `analysis-DataDog-datadog-lambda-python`

## Downloading Artifacts

GitHub Actions artifacts require authentication. To download the artifacts, run:

```bash
GITHUB_TOKEN=your_token_here bun scripts/fetch-artifacts.ts
```

You can create a GitHub Personal Access Token with `actions:read` permission at:
https://github.com/settings/tokens

## Data Structure

Each benchmark artifact contains:
- `benchmark.json` - Full evaluation run export with scores, episodes, and usage data

Each analysis artifact contains:
- `analysis.txt` - Judge analysis text
- `analysis-info.json` - Metadata with eval info and job URL
