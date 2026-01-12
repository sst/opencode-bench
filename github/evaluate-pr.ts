#!/usr/bin/env bun
import { Logger } from "../src/util/logger.js";
import { PrEval } from "../src/pr-eval/index.js";
import { Reporter } from "../src/pr-eval/reporter.js";
import { addIssueComment, addIssueLabels } from "../src/util/github.js";

const prUrl = process.env.PR_URL;
const issueNumber = process.env.ISSUE_NUMBER;
const repoOwner = process.env.REPO_OWNER;
const repoName = process.env.REPO_NAME;

if (!prUrl) {
  console.error("PR_URL environment variable is required");
  process.exit(1);
}

if (!issueNumber) {
  console.error("ISSUE_NUMBER environment variable is required");
  process.exit(1);
}

if (!repoOwner || !repoName) {
  console.error("REPO_OWNER and REPO_NAME environment variables are required");
  process.exit(1);
}

const issueNum = parseInt(issueNumber, 10);
if (isNaN(issueNum)) {
  console.error("ISSUE_NUMBER must be a valid number");
  process.exit(1);
}

const logger = Logger.create("[pr-eval]");

async function main() {
  logger.log(`Evaluating PR: ${prUrl}`);
  logger.log(`Will post results to issue #${issueNum}`);

  try {
    const result = await PrEval.evaluate(prUrl, { logger });

    const comment = Reporter.formatComment(result);
    const labels = Reporter.getLabels(result);

    logger.log(`Posting comment to ${repoOwner}/${repoName}#${issueNum}...`);
    await addIssueComment(repoOwner, repoName, issueNum, comment);

    logger.log(`Adding labels: ${labels.join(", ")}...`);
    await addIssueLabels(repoOwner, repoName, issueNum, labels);

    logger.log(`Evaluation complete: ${result.recommendation}`);
    logger.log(`Final score: ${result.finalScore.toFixed(1)}/100`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Evaluation failed: ${message}`);

    const errorComment = `## Evaluation Failed

Unable to evaluate PR candidate:

\`\`\`
${message}
\`\`\`

Please check that:
- The PR URL is valid and the repository is public
- The PR exists and is accessible

If the issue persists, please contact a maintainer.`;

    try {
      await addIssueComment(repoOwner, repoName, issueNum, errorComment);
      await addIssueLabels(repoOwner, repoName, issueNum, ["benchmark-evaluation-failed"]);
    } catch (commentError) {
      logger.error(`Failed to post error comment: ${commentError}`);
    }

    process.exit(1);
  }
}

main();
