/**
 * Structured logger using Pino.
 *
 * Features:
 * - Environment-aware: pretty-prints in dev, JSON in production
 * - Correlation / request IDs threaded through child loggers
 * - Named child loggers per subsystem (webhook, linq, screening, ...)
 * - Never throws — logging failures are swallowed to avoid cascading
 */
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const logLevel = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info");

const transport = isDev
  ? { target: "pino-pretty", options: { colorize: true, singleLine: false } }
  : undefined;

export const logger = pino({
  level: logLevel,
  transport,
  base: {
    service: "candidateflow",
    env: process.env.NODE_ENV ?? "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

/**
 * Create a child logger with a fixed context.
 * Use per-request, per-webhook, per-subsystem.
 */
export function createLogger(
  context: Record<string, unknown>
): pino.Logger {
  return logger.child(context);
}

/**
 * Convenience: create a request-scoped logger from a requestId.
 */
export function requestLogger(requestId: string): pino.Logger {
  return logger.child({ requestId });
}

/**
 * Subsystem loggers — import these for module-level logging.
 */
export const dbLogger = logger.child({ subsystem: "db" });
export const linqLogger = logger.child({ subsystem: "linq" });
export const webhookLogger = logger.child({ subsystem: "webhook" });
export const screeningLogger = logger.child({ subsystem: "screening" });
export const retryLogger = logger.child({ subsystem: "retry" });
export const authLogger = logger.child({ subsystem: "auth" });
