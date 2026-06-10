/**
 * Centralized API route error handler.
 *
 * Wraps a route handler to:
 * - Catch all thrown errors
 * - Map AppError subclasses to structured JSON responses
 * - Log unexpected errors with request context
 * - Never leak stack traces to the client
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";
import {
  AppError,
  ValidationError,
  toAppError,
  isAppError,
} from "@/lib/errors";
import { nanoid } from "nanoid";

// In Next.js 15+, params is a Promise. context is optional (not present on non-dynamic routes).
// The generic TParams lets dynamic routes narrow their params shape (e.g. { id: string })
// while still being assignable to the base RouteHandler type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RouteHandler<TParams extends Record<string, string> = any> = (
  req: NextRequest,
  context?: { params: Promise<TParams> }
) => Promise<Response>;

export type ApiResponse<T = unknown> =
  | { data: T; requestId: string }
  | {
      error: {
        code: string;
        message: string;
        details?: unknown;
        requestId: string;
      };
    };

/**
 * Wrap an API route handler with standardized error handling + request logging.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrorHandler<TParams extends Record<string, string> = any>(
  handler: RouteHandler<TParams>
): RouteHandler<TParams> {
  return async (req: NextRequest, context?) => {
    const requestId = req.headers.get("x-request-id") ?? nanoid(12);
    const start = Date.now();
    const log = logger.child({
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
    });

    log.info({ msg: "API request received" });

    try {
      const response = await handler(req, context);

      log.info({
        msg: "API request completed",
        status: response.status,
        durationMs: Date.now() - start,
      });

      // Attach request ID to response for client-side correlation
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (err) {
      const durationMs = Date.now() - start;

      // Handle Zod validation errors
      if (err instanceof ZodError) {
        const appErr = new ValidationError("Validation failed", err.flatten());
        log.warn({
          msg: "Validation error",
          code: appErr.code,
          details: appErr.details,
          durationMs,
        });
        return errorResponse(appErr, requestId);
      }

      // Handle known AppError subclasses
      if (isAppError(err)) {
        const level = err.httpStatus >= 500 ? "error" : "warn";
        log[level]({
          msg: "Request failed",
          code: err.code,
          httpStatus: err.httpStatus,
          error: err.message,
          durationMs,
        });
        return errorResponse(err, requestId);
      }

      // Unknown error — map and log at error level
      const appErr = toAppError(err);
      log.error({
        msg: "Unexpected error",
        error: appErr.message,
        originalError: err instanceof Error ? err.stack : String(err),
        durationMs,
      });

      return errorResponse(appErr, requestId);
    }
  };
}

function errorResponse(err: AppError, requestId: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    },
    {
      status: err.httpStatus,
      headers: { "x-request-id": requestId },
    }
  );
}

/**
 * Success response helper — enforces consistent envelope shape.
 */
export function successResponse<T>(
  data: T,
  options?: { status?: number; requestId?: string }
): NextResponse {
  const requestId = options?.requestId ?? nanoid(12);
  return NextResponse.json(
    { data, requestId },
    {
      status: options?.status ?? 200,
      headers: { "x-request-id": requestId },
    }
  );
}
