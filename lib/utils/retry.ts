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

export interface TimeoutOptions {
  timeoutMs: number;
  timeoutMessage?: string;
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const { timeoutMs, timeoutMessage = `Operation timed out after ${timeoutMs}ms` } = options;

  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}
