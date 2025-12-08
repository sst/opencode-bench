import { Logger } from "../logger.js";

export async function withRetries<T>(
  fn: () => Promise<T>,
  options: {
    retries: number;
    timeoutMs: number;
    logger: Logger.Instance;
  },
) {
  const { retries, timeoutMs, logger } = options;
  let attempt = 0;

  do {
    try {
      attempt += 1;
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  logger.format(`Operation timed out after ${timeoutMs}ms`),
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Attempt ${attempt}/${retries} failed: ${msg}`);
      if (attempt >= retries)
        throw error instanceof Error ? error : new Error(String(error));

      logger.log(`Attempt ${attempt + 1}/${retries} started`);
    }
  } while (true);
}
