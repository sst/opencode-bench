export function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function variance(avg: number, values: number[]) {
  return (
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  );
}

export function weightedSum(entries: { value: number; weight: number }[]) {
  return entries.reduce((sum, { value, weight }) => sum + value * weight, 0);
}
