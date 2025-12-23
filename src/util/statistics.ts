/**
 * Statistical utility functions for multi-run evaluations
 */

/**
 * Calculate the mean (average) of an array of numbers
 */
export function calculateMean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate the sample standard deviation
 */
export function calculateStdDev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = calculateMean(values);
  const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calculate 95% confidence interval using t-distribution
 * Returns [lower bound, upper bound]
 */
export function calculateConfidenceInterval(
  values: number[],
  _confidenceLevel: number = 0.95,
): [number, number] {
  if (values.length < 2) {
    const val = values[0] || 0;
    return [val, val];
  }

  const mean = calculateMean(values);
  const stdDev = calculateStdDev(values);
  const n = values.length;

  // t-distribution critical values for common sample sizes at 95% confidence
  // For n >= 30, we can approximate with z-score (1.96)
  const tValues: Record<number, number> = {
    2: 12.706,
    3: 4.303,
    4: 3.182,
    5: 2.776,
    6: 2.571,
    7: 2.447,
    8: 2.365,
    9: 2.306,
    10: 2.262,
  };

  const tValue = n >= 10 ? 2.262 : (tValues[n] || 1.96);
  const marginOfError = tValue * (stdDev / Math.sqrt(n));

  return [mean - marginOfError, mean + marginOfError];
}

/**
 * Calculate Fleiss' kappa for inter-rater reliability
 * Measures agreement among multiple judges on binary scores (0 or 1)
 *
 * @param judgeScores - 2D array where each row is a set of judge scores for one item
 *                      Example: [[1, 1, 0], [0, 0, 0], [1, 1, 1]] for 3 items judged by 3 judges
 * @returns kappa value between -1 and 1 (higher = more agreement)
 *          < 0: Less than chance agreement
 *          0.0-0.20: Slight agreement
 *          0.21-0.40: Fair agreement
 *          0.41-0.60: Moderate agreement
 *          0.61-0.80: Substantial agreement
 *          0.81-1.00: Almost perfect agreement
 */
export function calculateFleissKappa(judgeScores: number[][]): number {
  if (judgeScores.length === 0 || judgeScores[0].length < 2) {
    return 0;
  }

  const n = judgeScores.length; // number of items
  const k = judgeScores[0].length; // number of judges

  // For binary scoring (0 or 1), we have 2 categories
  // const categoryCount = 2; // Not used in calculation, kept for reference

  // Calculate P_i (proportion of all assignments to each category, for each item)
  const P_i: number[] = [];
  for (const scores of judgeScores) {
    const ones = scores.filter(s => s === 1).length;
    const zeros = scores.filter(s => s === 0).length;
    // P_i = (1/(k*(k-1))) * sum((n_ij^2 - k))
    // where n_ij is count of category j for item i
    const p = (1 / (k * (k - 1))) * (ones * ones + zeros * zeros - k);
    P_i.push(p);
  }

  // P_bar (mean of P_i)
  const P_bar = calculateMean(P_i);

  // P_j (proportion of all assignments to each category)
  let totalOnes = 0;
  let totalZeros = 0;
  for (const scores of judgeScores) {
    totalOnes += scores.filter(s => s === 1).length;
    totalZeros += scores.filter(s => s === 0).length;
  }
  const totalAssignments = n * k;
  const P_ones = totalOnes / totalAssignments;
  const P_zeros = totalZeros / totalAssignments;

  // P_e_bar (expected agreement by chance)
  const P_e_bar = P_ones * P_ones + P_zeros * P_zeros;

  // Fleiss' kappa
  if (P_e_bar === 1) {
    return 1; // Perfect agreement
  }

  const kappa = (P_bar - P_e_bar) / (1 - P_e_bar);
  return kappa;
}

/**
 * Interpret Fleiss' kappa value
 */
export function interpretKappa(kappa: number): string {
  if (kappa < 0) return "Less than chance agreement";
  if (kappa <= 0.20) return "Slight agreement";
  if (kappa <= 0.40) return "Fair agreement";
  if (kappa <= 0.60) return "Moderate agreement";
  if (kappa <= 0.80) return "Substantial agreement";
  return "Almost perfect agreement";
}

/**
 * Calculate minimum, maximum, and range of values
 */
export function calculateRange(values: number[]): {
  min: number;
  max: number;
  range: number;
} {
  if (values.length === 0) {
    return { min: 0, max: 0, range: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, range: max - min };
}
