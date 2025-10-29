/**
 * Judges Summary Script
 *
 * Analyzes and summarizes judge evaluations from benchmark output files.
 * Provides insights into judge agreement patterns, variance statistics,
 * and highlights cases of consensus vs. disagreement.
 *
 * Usage:
 *   bun run scripts/judges-summary.ts <benchmark-file.json>
 *   bun run scripts/judges-summary.ts <benchmark-file.json> --ai-summary
 *
 * Options:
 *   --ai-summary    Generate AI-powered analysis of judge patterns using an LLM
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { generateText } from "ai";
import type { EvaluationRunExport, JudgeResultExport } from "~/types/export.js";
import { getZenLanguageModel } from "~/lib/zenModels.js";

interface JudgeStats {
  name: string;
  totalEvaluations: number;
  averageScore: number;
  minScore: number;
  maxScore: number;
  standardDeviation: number;
}

interface MetricAnalysis {
  metricName: string;
  averageScore: number;
  variance: number;
  standardDeviation: number;
  judgeScores: Array<{ judge: string; score: number; rationale: string }>;
  hasDisagreement: boolean;
  scoreRange: number;
}

interface DisagreementCase {
  metricName: string;
  scores: Array<{ judge: string; score: number; rationale: string }>;
  variance: number;
  scoreRange: number;
}

interface JudgesSummary {
  evaluationInfo: {
    agent: string;
    repo: string;
    model: string;
    finalScore: number;
  };
  overallStats: {
    totalMetrics: number;
    averageVariance: number;
    averageStandardDeviation: number;
    highAgreementCount: number; // variance < 0.01
    moderateAgreementCount: number; // 0.01 <= variance < 0.1
    lowAgreementCount: number; // variance >= 0.1
  };
  judgeStats: JudgeStats[];
  metricAnalyses: MetricAnalysis[];
  disagreements: DisagreementCase[];
  pairwiseAgreement: Map<string, number>;
}

function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function analyzeJudgeResults(evaluation: EvaluationRunExport): JudgesSummary {
  // Collect all judge results across all metrics
  const judgeScoresMap = new Map<string, number[]>();
  const metricAnalyses: MetricAnalysis[] = [];
  const disagreements: DisagreementCase[] = [];

  // Process each metric
  for (const score of evaluation.scores) {
    const judgeScores: Array<{ judge: string; score: number; rationale: string }> = [];
    const scores: number[] = [];

    for (const judge of score.judges) {
      judgeScores.push({
        judge: judge.name,
        score: judge.score,
        rationale: judge.rationale,
      });
      scores.push(judge.score);

      // Track per-judge scores
      if (!judgeScoresMap.has(judge.name)) {
        judgeScoresMap.set(judge.name, []);
      }
      judgeScoresMap.get(judge.name)!.push(judge.score);
    }

    const averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = score.variance;
    const standardDeviation = calculateStandardDeviation(scores);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scoreRange = maxScore - minScore;
    const hasDisagreement = scoreRange > 0.2; // Flag if range > 0.2

    const analysis: MetricAnalysis = {
      metricName: score.assignment.name,
      averageScore,
      variance,
      standardDeviation,
      judgeScores,
      hasDisagreement,
      scoreRange,
    };

    metricAnalyses.push(analysis);

    // Track significant disagreements
    if (hasDisagreement) {
      disagreements.push({
        metricName: score.assignment.name,
        scores: judgeScores,
        variance,
        scoreRange,
      });
    }
  }

  // Calculate per-judge statistics
  const judgeStats: JudgeStats[] = [];
  for (const [judgeName, scores] of judgeScoresMap.entries()) {
    const averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const standardDeviation = calculateStandardDeviation(scores);

    judgeStats.push({
      name: judgeName,
      totalEvaluations: scores.length,
      averageScore,
      minScore,
      maxScore,
      standardDeviation,
    });
  }

  // Sort judges by name for consistent output
  judgeStats.sort((a, b) => a.name.localeCompare(b.name));

  // Calculate overall statistics
  const variances = metricAnalyses.map(m => m.variance);
  const averageVariance = variances.reduce((sum, v) => sum + v, 0) / variances.length;
  const averageStandardDeviation = metricAnalyses
    .map(m => m.standardDeviation)
    .reduce((sum, sd) => sum + sd, 0) / metricAnalyses.length;

  const highAgreementCount = metricAnalyses.filter(m => m.variance < 0.01).length;
  const moderateAgreementCount = metricAnalyses.filter(
    m => m.variance >= 0.01 && m.variance < 0.1
  ).length;
  const lowAgreementCount = metricAnalyses.filter(m => m.variance >= 0.1).length;

  // Calculate pairwise agreement (placeholder - requires episode data)
  const pairwiseAgreement = new Map<string, number>();

  return {
    evaluationInfo: {
      agent: evaluation.agent,
      repo: evaluation.evaluation.repo,
      model: evaluation.model,
      finalScore: evaluation.finalScore,
    },
    overallStats: {
      totalMetrics: metricAnalyses.length,
      averageVariance,
      averageStandardDeviation,
      highAgreementCount,
      moderateAgreementCount,
      lowAgreementCount,
    },
    judgeStats,
    metricAnalyses,
    disagreements,
    pairwiseAgreement,
  };
}

function printSummary(summary: JudgesSummary): void {
  const { evaluationInfo, overallStats, judgeStats, metricAnalyses, disagreements } = summary;

  console.log("═".repeat(80));
  console.log("JUDGES SUMMARY REPORT");
  console.log("═".repeat(80));
  console.log();

  // Evaluation Info
  console.log("📊 Evaluation Information");
  console.log("─".repeat(80));
  console.log(`  Repository:   ${evaluationInfo.repo}`);
  console.log(`  Agent:        ${evaluationInfo.agent}`);
  console.log(`  Model:        ${evaluationInfo.model}`);
  console.log(`  Final Score:  ${evaluationInfo.finalScore.toFixed(3)}`);
  console.log();

  // Overall Statistics
  console.log("📈 Overall Judge Agreement Statistics");
  console.log("─".repeat(80));
  console.log(`  Total Metrics:           ${overallStats.totalMetrics}`);
  console.log(`  Average Variance:        ${overallStats.averageVariance.toFixed(4)}`);
  console.log(`  Average Std Deviation:   ${overallStats.averageStandardDeviation.toFixed(4)}`);
  console.log();
  console.log("  Agreement Distribution:");
  console.log(`    High (variance < 0.01):       ${overallStats.highAgreementCount} metrics (${((overallStats.highAgreementCount / overallStats.totalMetrics) * 100).toFixed(1)}%)`);
  console.log(`    Moderate (0.01 ≤ var < 0.1):  ${overallStats.moderateAgreementCount} metrics (${((overallStats.moderateAgreementCount / overallStats.totalMetrics) * 100).toFixed(1)}%)`);
  console.log(`    Low (variance ≥ 0.1):         ${overallStats.lowAgreementCount} metrics (${((overallStats.lowAgreementCount / overallStats.totalMetrics) * 100).toFixed(1)}%)`);
  console.log();

  // Per-Judge Statistics
  console.log("👨‍⚖️ Individual Judge Statistics");
  console.log("─".repeat(80));
  for (const judge of judgeStats) {
    console.log(`  ${judge.name}:`);
    console.log(`    Evaluations:      ${judge.totalEvaluations}`);
    console.log(`    Average Score:    ${judge.averageScore.toFixed(3)}`);
    console.log(`    Score Range:      ${judge.minScore.toFixed(3)} - ${judge.maxScore.toFixed(3)}`);
    console.log(`    Std Deviation:    ${judge.standardDeviation.toFixed(4)}`);
    console.log();
  }

  // Per-Metric Analysis
  console.log("📋 Per-Metric Analysis");
  console.log("─".repeat(80));

  // Sort metrics by variance (highest first) to show disagreements first
  const sortedMetrics = [...metricAnalyses].sort((a, b) => b.variance - a.variance);

  for (const metric of sortedMetrics) {
    const agreementIcon = metric.variance < 0.01 ? "✅" : metric.variance < 0.1 ? "⚠️" : "❌";
    console.log(`  ${agreementIcon} ${metric.metricName}`);
    console.log(`     Average Score: ${metric.averageScore.toFixed(3)}`);
    console.log(`     Variance:      ${metric.variance.toFixed(4)}`);
    console.log(`     Std Dev:       ${metric.standardDeviation.toFixed(4)}`);
    console.log(`     Score Range:   ${metric.scoreRange.toFixed(3)}`);
    console.log();

    for (const judgeScore of metric.judgeScores) {
      console.log(`       ${judgeScore.judge.padEnd(15)} → ${judgeScore.score.toFixed(3)}`);
    }
    console.log();
  }

  // Disagreement Cases
  if (disagreements.length > 0) {
    console.log("🔍 Significant Disagreements (score range > 0.2)");
    console.log("─".repeat(80));

    // Sort by score range (highest first)
    const sortedDisagreements = [...disagreements].sort((a, b) => b.scoreRange - a.scoreRange);

    for (const disagreement of sortedDisagreements) {
      console.log(`  Metric: ${disagreement.metricName}`);
      console.log(`    Score Range: ${disagreement.scoreRange.toFixed(3)}`);
      console.log(`    Variance:    ${disagreement.variance.toFixed(4)}`);
      console.log();

      for (const score of disagreement.scores) {
        console.log(`    ${score.judge} → ${score.score.toFixed(3)}`);
        // Truncate rationale to first 150 characters
        const truncatedRationale = score.rationale.length > 150
          ? score.rationale.substring(0, 150) + "..."
          : score.rationale;
        console.log(`      ${truncatedRationale.replace(/\n/g, " ")}`);
        console.log();
      }
    }
  } else {
    console.log("✅ No Significant Disagreements Found");
    console.log("─".repeat(80));
    console.log("  All metrics had judge score ranges ≤ 0.2");
    console.log();
  }

  console.log("═".repeat(80));
}

const ANALYZER_MODEL = process.env.ANALYZER_MODEL?.trim() || "opencode/claude-sonnet-4-5";

async function generateAIAnalysis(summary: JudgesSummary): Promise<string> {
  const { evaluationInfo, overallStats, judgeStats, metricAnalyses, disagreements } = summary;

  // Build context for the LLM
  const contextParts: string[] = [];

  // Overall statistics
  contextParts.push("# Overall Judge Agreement");
  contextParts.push(`- Total Metrics: ${overallStats.totalMetrics}`);
  contextParts.push(`- Average Variance: ${overallStats.averageVariance.toFixed(4)}`);
  contextParts.push(`- Average Std Deviation: ${overallStats.averageStandardDeviation.toFixed(4)}`);
  contextParts.push(`- High Agreement: ${overallStats.highAgreementCount} metrics (${((overallStats.highAgreementCount / overallStats.totalMetrics) * 100).toFixed(1)}%)`);
  contextParts.push(`- Low Agreement: ${overallStats.lowAgreementCount} metrics (${((overallStats.lowAgreementCount / overallStats.totalMetrics) * 100).toFixed(1)}%)`);
  contextParts.push("");

  // Per-judge stats
  contextParts.push("# Individual Judge Statistics");
  for (const judge of judgeStats) {
    contextParts.push(`## ${judge.name}`);
    contextParts.push(`- Evaluations: ${judge.totalEvaluations}`);
    contextParts.push(`- Average Score: ${judge.averageScore.toFixed(3)}`);
    contextParts.push(`- Score Range: ${judge.minScore.toFixed(3)} - ${judge.maxScore.toFixed(3)}`);
    contextParts.push(`- Std Deviation: ${judge.standardDeviation.toFixed(4)}`);
    contextParts.push("");
  }

  // Disagreements with full rationales
  if (disagreements.length > 0) {
    contextParts.push("# Significant Disagreements (score range > 0.2)");
    for (const disagreement of disagreements) {
      contextParts.push(`## Metric: ${disagreement.metricName}`);
      contextParts.push(`- Score Range: ${disagreement.scoreRange.toFixed(3)}`);
      contextParts.push(`- Variance: ${disagreement.variance.toFixed(4)}`);
      contextParts.push("");

      for (const score of disagreement.scores) {
        contextParts.push(`### ${score.judge} → ${score.score.toFixed(3)}`);
        contextParts.push(`Rationale: ${score.rationale}`);
        contextParts.push("");
      }
    }
  }

  // All metrics with scores
  contextParts.push("# All Metric Analyses");
  for (const metric of metricAnalyses) {
    contextParts.push(`## ${metric.metricName}`);
    contextParts.push(`- Average Score: ${metric.averageScore.toFixed(3)}`);
    contextParts.push(`- Variance: ${metric.variance.toFixed(4)}`);
    contextParts.push(`- Score Range: ${metric.scoreRange.toFixed(3)}`);
    contextParts.push("");

    for (const judgeScore of metric.judgeScores) {
      contextParts.push(`### ${judgeScore.judge} → ${judgeScore.score.toFixed(3)}`);
      // Include full rationale for analysis
      contextParts.push(`Rationale: ${judgeScore.rationale}`);
      contextParts.push("");
    }
  }

  const context = contextParts.join("\n");

  const systemPrompt = `You are an expert analyst reviewing judge evaluation patterns from a code benchmark system.

Your task is to analyze the judge scoring data and rationales to identify:
1. **Systematic patterns**: Are certain judges consistently more strict or lenient?
2. **Disagreement trends**: Which metrics cause the most disagreement and why?
3. **Judge biases**: Do judges focus on different aspects or have different interpretations?
4. **Notable insights**: Any interesting patterns in how judges evaluate the same code?
5. **Recommendations**: What could be done to improve judge agreement or refine evaluation criteria?

Focus on concrete observations from the rationales provided. Look for patterns like:
- One judge focusing on technical correctness vs. another on edge cases
- Different interpretations of what constitutes a "match" or "failure"
- Consistent scoring differences between specific judges
- Metrics where judges fundamentally disagree on evaluation criteria

Provide a concise, insightful analysis (3-5 paragraphs) that would help developers understand judge behavior and improve the evaluation system.`;

  const userPrompt = `Analyze the following judge evaluation data for the repository "${evaluationInfo.repo}":

${context}

Provide a high-level analysis of judge scoring patterns, trends, and notable insights.`;

  try {
    const { text } = await generateText({
      model: getZenLanguageModel(ANALYZER_MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3, // Slightly creative but still focused
    });

    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error generating AI analysis: ${message}`;
  }
}

async function printAIAnalysis(summary: JudgesSummary): Promise<void> {
  console.log("\n🤖 AI-Powered Analysis");
  console.log("─".repeat(80));
  console.log("Analyzing judge patterns... (this may take a moment)");

  const analysis = await generateAIAnalysis(summary);

  console.log();
  // Word-wrap the analysis at 80 characters for better readability
  const lines = analysis.split("\n");
  for (const line of lines) {
    if (line.length <= 80) {
      console.log(`  ${line}`);
    } else {
      // Simple word wrap
      const words = line.split(" ");
      let currentLine = "  ";
      for (const word of words) {
        if ((currentLine + word).length > 80) {
          console.log(currentLine);
          currentLine = "  " + word + " ";
        } else {
          currentLine += word + " ";
        }
      }
      if (currentLine.trim().length > 0) {
        console.log(currentLine);
      }
    }
  }
  console.log();
  console.log("─".repeat(80));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run scripts/judges-summary.ts <benchmark-file.json> [--ai-summary]");
    console.error("");
    console.error("Options:");
    console.error("  --ai-summary    Generate AI-powered analysis of judge patterns");
    process.exit(1);
  }

  // Parse arguments
  const filePath = args[0];
  const useAIAnalysis = args.includes("--ai-summary");

  let evaluation: EvaluationRunExport;

  try {
    const fileContent = readFileSync(filePath, "utf-8");
    evaluation = JSON.parse(fileContent) as EvaluationRunExport;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    process.exit(1);
  }

  const summary = analyzeJudgeResults(evaluation);
  printSummary(summary);

  // Generate AI analysis if requested
  if (useAIAnalysis) {
    await printAIAnalysis(summary);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
