export type Retryable<T> = () => Promise<T> | T;

export interface RetryOptions {
  retries: number;
  onRetry?: (error: unknown, attempt: number, retries: number) => void;
}

export async function withRetries<T>(fn: Retryable<T>, options: RetryOptions): Promise<T> {
  const { retries, onRetry } = options;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    try {
      attempt += 1;
      return await fn();
    } catch (error) {
      lastError = error;
      onRetry?.(error, attempt, retries);
      if (attempt >= retries) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
