/**
 * In-process token bucket rate limiter.
 *
 * Suitable for single-instance / serverless-function deployments.
 * For multi-instance production: swap this for an Upstash Redis
 * implementation behind the same `RateLimiter` interface.
 *
 * Each bucket is keyed by an arbitrary string (IP, user ID, endpoint, ...).
 * Tokens replenish continuously at `refillRate` tokens/second.
 */

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number; // ms timestamp
}

interface TokenBucketOptions {
  /** Maximum tokens in the bucket (burst capacity) */
  capacity: number;
  /** Tokens added per second */
  refillRatePerSecond: number;
}

class TokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillRatePerSecond: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillRatePerSecond = options.refillRatePerSecond;
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSec * this.refillRatePerSecond
    );
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetInMs: Math.ceil((1 - bucket.tokens) / this.refillRatePerSecond * 1000),
      };
    }

    const resetInMs = Math.ceil(
      (1 - bucket.tokens) / this.refillRatePerSecond * 1000
    );
    return { allowed: false, remaining: 0, resetInMs };
  }
}

/**
 * Preconfigured limiters for different surfaces.
 */

/** Webhook endpoint: 100 req/min per IP */
export const webhookRateLimiter: RateLimiter = new TokenBucketRateLimiter({
  capacity: 100,
  refillRatePerSecond: 100 / 60,
});

/** Auth endpoints: 10 attempts/min per IP */
export const authRateLimiter: RateLimiter = new TokenBucketRateLimiter({
  capacity: 10,
  refillRatePerSecond: 10 / 60,
});

/** Message send API: 30 req/min per user */
export const messageSendRateLimiter: RateLimiter = new TokenBucketRateLimiter({
  capacity: 30,
  refillRatePerSecond: 30 / 60,
});
