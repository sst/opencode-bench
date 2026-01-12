import { PrEval } from "./index.js";

export namespace Reporter {
  const STATUS_ICONS = {
    approved: ":white_check_mark:",
    rejected: ":x:",
    "needs-review": ":warning:",
  } as const;

  const STATUS_LABELS = {
    approved: "Approved",
    rejected: "Rejected",
    "needs-review": "Needs Review",
  } as const;

  export function formatComment(result: PrEval.EvaluationResult): string {
    const statusIcon = STATUS_ICONS[result.recommendation];
    const statusLabel = STATUS_LABELS[result.recommendation];

    const criteriaTable = result.criteria
      .map((c) => {
        const consensus = PrEval.getConsensusLevel(c.variance);
        const consensusEmoji =
          consensus === "high" ? ":green_circle:" : consensus === "medium" ? ":yellow_circle:" : ":red_circle:";
        return `| ${c.displayName} | ${c.average.toFixed(0)}/100 | ${consensusEmoji} ${capitalize(consensus)} |`;
      })
      .join("\n");

    const criteriaDetails = result.criteria
      .map((c) => {
        const judgeScores = c.judges
          .map((j) => `- **${formatJudgeName(j.judge)}**: ${j.score}/100`)
          .join("\n");

        const combinedRationale = c.judges
          .map((j) => `**${formatJudgeName(j.judge)}**: ${j.rationale}`)
          .join("\n\n");

        return `<details>
<summary><b>${c.displayName} (${c.average.toFixed(0)}/100)</b></summary>

### Judge Scores
${judgeScores}

### Rationale
${combinedRationale}

</details>`;
      })
      .join("\n\n");

    return `## Benchmark Candidate Evaluation

**PR:** [${result.owner}/${result.repo}#${result.prNumber}](${result.prUrl})
**Status:** ${statusIcon} **${statusLabel}**
**Final Score:** ${result.finalScore.toFixed(1)}/100

---

### Criterion Scores

| Criterion | Score | Consensus |
|-----------|-------|-----------|
${criteriaTable}

---

### Detailed Analysis

${criteriaDetails}

---

### Scoring Details

- **Base Score:** ${result.baseScore.toFixed(1)}/100
- **Disagreement Penalty:** -${result.penalty.toFixed(1)}
- **Final Score:** ${result.finalScore.toFixed(1)}/100

${getRecommendationMessage(result.recommendation)}

---

*Evaluated by [opencode-bench](https://github.com/sst/opencode-bench) on ${formatDate(result.evaluatedAt)}*
*Judges: ${result.criteria[0]?.judges.map((j) => formatJudgeName(j.judge)).join(", ")}*`;
  }

  export function getLabels(result: PrEval.EvaluationResult): string[] {
    const labels = ["benchmark-evaluation"];

    switch (result.recommendation) {
      case "approved":
        labels.push("benchmark-approved");
        break;
      case "rejected":
        labels.push("benchmark-rejected");
        break;
      case "needs-review":
        labels.push("benchmark-needs-review");
        break;
    }

    return labels;
  }

  function formatJudgeName(judge: string): string {
    return judge.replace("opencode/", "").replace(/-/g, " ");
  }

  function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toISOString().split("T")[0];
  }

  function getRecommendationMessage(recommendation: PrEval.Recommendation): string {
    switch (recommendation) {
      case "approved":
        return `> :white_check_mark: **This PR appears to be a good candidate for the benchmark.** A maintainer will review and may add it to the evaluation suite.`;
      case "needs-review":
        return `> :warning: **This PR may be suitable but requires manual review.** A maintainer will evaluate whether it meets benchmark requirements.`;
      case "rejected":
        return `> :x: **This PR does not appear suitable for the benchmark.** See the detailed analysis above for specific issues. You may submit a different PR or provide additional context.`;
    }
  }
}
