/**
 * Backoff calculation unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeNextRunAt,
  computeNextRunAtWithRateLimit,
  isExhausted,
  getMaxAttempts,
} from "@/services/retry/backoff";

describe("computeNextRunAt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a future date", () => {
    const result = computeNextRunAt(1);
    expect(result.getTime()).toBeGreaterThan(Date.now());
  });

  it("increases delay with higher attempts", () => {
    const attempt1 = computeNextRunAt(1, { jitterFactor: 0 });
    const attempt2 = computeNextRunAt(2, { jitterFactor: 0 });
    const attempt3 = computeNextRunAt(3, { jitterFactor: 0 });

    expect(attempt2.getTime()).toBeGreaterThan(attempt1.getTime());
    expect(attempt3.getTime()).toBeGreaterThan(attempt2.getTime());
  });

  it("caps at maxDelayMs", () => {
    const maxDelayMs = 10_000;
    // Attempt 100 would be astronomically large without cap
    const result = computeNextRunAt(100, { maxDelayMs, jitterFactor: 0 });
    const delayMs = result.getTime() - Date.now();
    expect(delayMs).toBeLessThanOrEqual(maxDelayMs + 100); // +100ms tolerance
  });

  it("uses custom baseDelayMs", () => {
    const result = computeNextRunAt(1, { baseDelayMs: 100, jitterFactor: 0 });
    const delayMs = result.getTime() - Date.now();
    expect(delayMs).toBeCloseTo(100, -1); // within 10ms
  });
});

describe("computeNextRunAtWithRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses rate limit delay when it is longer than backoff", () => {
    // Large retryAfterSeconds should dominate
    const retryAfterSeconds = 300; // 5 min
    const result = computeNextRunAtWithRateLimit(1, retryAfterSeconds, {
      baseDelayMs: 100,
      jitterFactor: 0,
    });
    const delayMs = result.getTime() - Date.now();
    // Should be ~300s, not ~0.1s
    expect(delayMs).toBeGreaterThanOrEqual(299_000);
  });

  it("uses backoff delay when it is longer than rate limit", () => {
    const result = computeNextRunAtWithRateLimit(5, 0, {
      baseDelayMs: 10_000,
      jitterFactor: 0,
    });
    const delayMs = result.getTime() - Date.now();
    // 10s * 2^4 = 160s, should be > 0
    expect(delayMs).toBeGreaterThan(0);
  });
});

describe("isExhausted", () => {
  it("returns true when attempt strictly exceeds maxAttempts", () => {
    expect(isExhausted(6, { maxAttempts: 5 })).toBe(true);
    expect(isExhausted(10, { maxAttempts: 5 })).toBe(true);
  });

  it("returns false when at maxAttempts (last attempt still in flight)", () => {
    // attempt === maxAttempts means the last attempt is running — not yet exhausted
    expect(isExhausted(5, { maxAttempts: 5 })).toBe(false);
  });

  it("returns false when attempts remain", () => {
    expect(isExhausted(1, { maxAttempts: 5 })).toBe(false);
    expect(isExhausted(4, { maxAttempts: 5 })).toBe(false);
  });
});

describe("getMaxAttempts", () => {
  it("returns default of 5 when not specified", () => {
    expect(getMaxAttempts()).toBe(5);
    expect(getMaxAttempts({})).toBe(5);
  });

  it("returns custom max when specified", () => {
    expect(getMaxAttempts({ maxAttempts: 3 })).toBe(3);
  });
});
