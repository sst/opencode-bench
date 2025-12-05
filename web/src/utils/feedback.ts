import type { ErrorAnalysisFeedback } from "../types/benchmark";

const FEEDBACK_STORAGE_KEY = "opencode-bench-feedback";

export function saveFeedback(feedback: ErrorAnalysisFeedback): void {
  const existing = getAllFeedback();
  existing.push(feedback);
  localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(existing));
}

export function getAllFeedback(): ErrorAnalysisFeedback[] {
  const stored = localStorage.getItem(FEEDBACK_STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function getFeedbackForComponent(
  componentType: ErrorAnalysisFeedback["componentType"],
  componentId: string
): ErrorAnalysisFeedback[] {
  return getAllFeedback().filter(
    (f) => f.componentType === componentType && f.componentId === componentId
  );
}

export function exportFeedbackAsJSON(): string {
  return JSON.stringify(getAllFeedback(), null, 2);
}

export function clearAllFeedback(): void {
  localStorage.removeItem(FEEDBACK_STORAGE_KEY);
}

export function generateFeedbackId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
