export interface RetryOptions {
  maxAttempts: number;
  baseMs: number;
  factor: number;
  jitter: () => number; // returns 0..1
}

export const DEFAULT_REFRESH_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseMs: 250,
  factor: 4,
  jitter: () => Math.random(),
};

/**
 * Generic exponential-backoff retry. The predicate decides whether the
 * result is "good" (return) or transient (retry). Honors a result-supplied
 * retryAfterMs hint as a floor on the delay.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  isTransient: (result: T) => false | { retryAfterMs: number },
  opts: RetryOptions = DEFAULT_REFRESH_RETRY,
): Promise<T> {
  let attempt = 0;
  while (true) {
    const result = await fn();
    const transient = isTransient(result);
    if (!transient || attempt >= opts.maxAttempts - 1) return result;
    const expBackoff = opts.baseMs * opts.factor ** attempt;
    const delay = Math.max(transient.retryAfterMs, expBackoff * (0.5 + opts.jitter() * 0.5));
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    attempt += 1;
  }
}
