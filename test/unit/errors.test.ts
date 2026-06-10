/**
 * Error class unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  LinqApiError,
  LinqRateLimitError,
  WebhookVerificationError,
  WebhookDuplicateError,
  InvalidStateTransitionError,
  DuplicateCandidateError,
  isAppError,
  toAppError,
} from "@/lib/errors";

describe("AppError hierarchy", () => {
  it("ValidationError has correct code and httpStatus", () => {
    const err = new ValidationError("test message", { field: "error" });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe("test message");
    expect(err.details).toEqual({ field: "error" });
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof ValidationError).toBe(true);
  });

  it("NotFoundError formats message with id", () => {
    const err = new NotFoundError("Candidate", "cuid123");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.httpStatus).toBe(404);
    expect(err.message).toContain("cuid123");
  });

  it("NotFoundError without id", () => {
    const err = new NotFoundError("Screening");
    expect(err.message).toBe("Screening not found");
  });

  it("LinqApiError includes provider name", () => {
    const err = new LinqApiError({ message: "Bad request", statusCode: 400 });
    expect(err.message).toContain("Linq");
    expect(err.provider).toBe("Linq");
    expect(err.statusCode).toBe(400);
  });

  it("LinqRateLimitError captures retryAfterSeconds", () => {
    const err = new LinqRateLimitError(60);
    expect(err.retryAfterSeconds).toBe(60);
    expect(err.httpStatus).toBe(502); // mapped as ExternalApiError
  });

  it("WebhookVerificationError has 401 status", () => {
    const err = new WebhookVerificationError();
    expect(err.httpStatus).toBe(401);
    expect(err.code).toBe("WEBHOOK_VERIFICATION_FAILED");
  });

  it("WebhookDuplicateError has 200 status (not an error from Linq's perspective)", () => {
    const err = new WebhookDuplicateError("event-123");
    expect(err.httpStatus).toBe(200);
    expect(err.message).toContain("event-123");
  });

  it("InvalidStateTransitionError includes state names", () => {
    const err = new InvalidStateTransitionError("COMPLETED", "STARTED");
    expect(err.message).toContain("COMPLETED");
    expect(err.message).toContain("STARTED");
    expect(err.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("DuplicateCandidateError includes phone number", () => {
    const err = new DuplicateCandidateError("+12125551234");
    expect(err.message).toContain("+12125551234");
    expect(err.code).toBe("DUPLICATE_CANDIDATE");
  });
});

describe("isAppError", () => {
  it("returns true for AppError instances", () => {
    expect(isAppError(new ValidationError("test"))).toBe(true);
    expect(isAppError(new NotFoundError("X"))).toBe(true);
  });

  it("returns false for plain errors", () => {
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(isAppError("string")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe("toAppError", () => {
  it("passes through AppError unchanged", () => {
    const original = new ValidationError("original");
    const result = toAppError(original);
    expect(result).toBe(original);
  });

  it("wraps plain Error", () => {
    const plain = new Error("plain message");
    const result = toAppError(plain);
    expect(result).toBeInstanceOf(AppError);
    expect(result.message).toBe("plain message");
    expect(result.code).toBe("INTERNAL_ERROR");
  });

  it("wraps unknown value", () => {
    const result = toAppError("string error");
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe("INTERNAL_ERROR");
  });
});
