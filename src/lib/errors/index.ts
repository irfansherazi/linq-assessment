/**
 * Centralized error hierarchy for CandidateFlow.
 *
 * Rules:
 * - Every error has a stable machine-readable `code` (SCREAMING_SNAKE_CASE)
 * - Every error has an `httpStatus` for API response mapping
 * - No silent failures: every catch block must re-throw or handle a typed error
 * - `withErrorHandler` wraps API routes to produce structured JSON responses
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "EXTERNAL_API_ERROR"
  | "LINQ_API_ERROR"
  | "LINQ_RATE_LIMIT"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "WEBHOOK_DUPLICATE"
  | "WEBHOOK_PROCESSING_ERROR"
  | "DATABASE_ERROR"
  | "BUSINESS_LOGIC_ERROR"
  | "CANDIDATE_NOT_FOUND"
  | "SCREENING_NOT_FOUND"
  | "SCREENING_ALREADY_STARTED"
  | "SCREENING_COMPLETED"
  | "INVALID_STATE_TRANSITION"
  | "DUPLICATE_CANDIDATE"
  | "MESSAGE_SEND_FAILED"
  | "RETRY_EXHAUSTED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: unknown;
  public readonly cause?: Error;

  constructor({
    message,
    code,
    httpStatus = 500,
    details,
    cause,
  }: {
    message: string;
    code: ErrorCode;
    httpStatus?: number;
    details?: unknown;
    cause?: Error;
  }) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.cause = cause;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      details: this.details,
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ message, code: "VALIDATION_ERROR", httpStatus: 400, details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super({
      message: id
        ? `${resource} with id "${id}" not found`
        : `${resource} not found`,
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ message, code: "CONFLICT", httpStatus: 409, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super({ message, code: "UNAUTHORIZED", httpStatus: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super({ message, code: "FORBIDDEN", httpStatus: 403 });
  }
}

export class ExternalApiError extends AppError {
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly responseBody?: unknown;

  constructor({
    provider,
    message,
    statusCode,
    responseBody,
    cause,
  }: {
    provider: string;
    message: string;
    statusCode?: number;
    responseBody?: unknown;
    cause?: Error;
  }) {
    super({
      message: `[${provider}] ${message}`,
      code: "EXTERNAL_API_ERROR",
      httpStatus: 502,
      details: { provider, statusCode, responseBody },
      cause,
    });
    this.provider = provider;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class LinqApiError extends AppError {
  public readonly provider = "Linq";
  public readonly linqErrorCode?: string | number;
  public readonly statusCode?: number;
  public readonly responseBody?: unknown;

  constructor({
    message,
    statusCode,
    responseBody,
    linqErrorCode,
    cause,
  }: {
    message: string;
    statusCode?: number;
    responseBody?: unknown;
    linqErrorCode?: string | number;
    cause?: Error;
  }) {
    super({
      message: `[Linq] ${message}`,
      code: "LINQ_API_ERROR",
      httpStatus: 502,
      details: { provider: "Linq", statusCode, responseBody },
      cause,
    });
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.linqErrorCode = linqErrorCode;
  }
}

export class LinqRateLimitError extends LinqApiError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, responseBody?: unknown) {
    super({
      message: `Rate limited by Linq API. Retry after ${retryAfterSeconds}s.`,
      statusCode: 429,
      responseBody,
    });
    // Override code after construction — use a fresh AppError-level override via Object.defineProperty
    // since `code` is readonly on AppError but we need a more specific value here.
    Object.defineProperty(this, "code", {
      value: "LINQ_RATE_LIMIT" as ErrorCode,
      writable: false,
      configurable: true,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class WebhookVerificationError extends AppError {
  constructor(message = "Webhook signature verification failed") {
    super({
      message,
      code: "WEBHOOK_VERIFICATION_FAILED",
      httpStatus: 401,
    });
  }
}

export class WebhookDuplicateError extends AppError {
  constructor(eventId: string) {
    super({
      message: `Webhook event "${eventId}" already processed (idempotency)`,
      code: "WEBHOOK_DUPLICATE",
      httpStatus: 200, // Not an error from Linq's perspective
    });
  }
}

export class WebhookProcessingError extends AppError {
  constructor(message: string, cause?: Error) {
    super({
      message,
      code: "WEBHOOK_PROCESSING_ERROR",
      httpStatus: 500,
      cause,
    });
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: Error) {
    super({ message, code: "DATABASE_ERROR", httpStatus: 500, cause });
  }
}

export class BusinessLogicError extends AppError {
  constructor(message: string, code: ErrorCode = "BUSINESS_LOGIC_ERROR") {
    super({ message, code, httpStatus: 422 });
  }
}

export class DuplicateCandidateError extends BusinessLogicError {
  constructor(phone: string) {
    super(`A candidate with phone number ${phone} already exists in this account`, "DUPLICATE_CANDIDATE");
  }
}

export class InvalidStateTransitionError extends BusinessLogicError {
  constructor(from: string, to: string) {
    super(
      `Invalid state transition: ${from} → ${to}`,
      "INVALID_STATE_TRANSITION"
    );
  }
}

export class MessageSendError extends AppError {
  constructor(message: string, cause?: Error) {
    super({ message, code: "MESSAGE_SEND_FAILED", httpStatus: 502, cause });
  }
}

/**
 * Type guard: check if an unknown value is an AppError
 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Map any thrown value to an AppError (never re-throw unknowns).
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError({
      message: err.message,
      code: "INTERNAL_ERROR",
      httpStatus: 500,
      cause: err,
    });
  }
  return new AppError({
    message: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
    httpStatus: 500,
    details: err,
  });
}
