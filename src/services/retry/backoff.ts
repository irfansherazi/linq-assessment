/**
 * Exponential backoff calculation for retry jobs.
 *
 * Formula: delay = min(baseDelayMs * 2^attempt, maxDelayMs) + jitter
 * Jitter: ±20% of the computed delay, to spread retries across time windows.
 *
 * Retry attempts and their approximate delays:
 *   Attempt 1: ~2s
 *   Attempt 2: ~4s
 *   Attempt 3: ~8s
 *   Attempt 4: ~16s
 *   Attempt 5: ~32s (→ DEAD_LETTER after this)
 */

export interface BackoffConfig {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitterFactor?: number; // fraction of delay to add as random jitter
}

const DEFAULTS: Required<BackoffConfig> = {
  baseDelayMs: 2_000,        // 2 seconds
  maxDelayMs: 5 * 60_000,    // 5 minutes cap
  maxAttempts: 5,
  jitterFactor: 0.2,
};

export function computeNextRunAt(
  attempt: number,
  config: BackoffConfig = {}
): Date {
  const {
    baseDelayMs,
    maxDelayMs,
    jitterFactor,
  } = { ...DEFAULTS, ...config };

  // Base exponential delay
  const exponentialMs = baseDelayMs * Math.pow(2, attempt - 1);
  const cappedMs = Math.min(exponentialMs, maxDelayMs);

  // Add jitter: ±jitterFactor of the computed delay
  const jitterRange = cappedMs * jitterFactor;
  const jitterMs = (Math.random() * 2 - 1) * jitterRange;

  const totalMs = Math.round(cappedMs + jitterMs);

  return new Date(Date.now() + totalMs);
}

/**
 * Compute next run time respecting a Retry-After header value.
 * If retryAfterSeconds > computed backoff, use retryAfterSeconds instead.
 */
export function computeNextRunAtWithRateLimit(
  attempt: number,
  retryAfterSeconds: number,
  config: BackoffConfig = {}
): Date {
  const backoffDate = computeNextRunAt(attempt, config);
  const rateLimitDate = new Date(Date.now() + retryAfterSeconds * 1000);
  return rateLimitDate > backoffDate ? rateLimitDate : backoffDate;
}

export function isExhausted(
  attempt: number,
  config: BackoffConfig = {}
): boolean {
  const maxAttempts = config.maxAttempts ?? DEFAULTS.maxAttempts;
  return attempt > maxAttempts;
}

export function getMaxAttempts(config: BackoffConfig = {}): number {
  return config.maxAttempts ?? DEFAULTS.maxAttempts;
}
