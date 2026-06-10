/**
 * Environment variable validation.
 * Validated once at module-load time; fatal error on missing required vars.
 * Import this module (not process.env) everywhere config values are needed.
 */
import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Auth
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters"),
  NEXTAUTH_URL: z.string().url().optional(),

  // Linq
  LINQ_API_KEY: z.string().min(1, "LINQ_API_KEY is required"),
  LINQ_API_BASE_URL: z
    .string()
    .url()
    .default("https://api.linqapp.com/api/partner/v3"),
  LINQ_FROM_PHONE: z
    .string()
    .regex(/^\+\d{10,15}$/, "LINQ_FROM_PHONE must be E.164 format")
    .optional(),
  LINQ_WEBHOOK_SECRET: z.string().optional(),
  LINQ_WEBHOOK_SUBSCRIPTION_ID: z.string().optional(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const formatted = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(", ")}`)
      .join("\n");

    throw new Error(
      `[env] Invalid environment variables:\n${formatted}\n\nCheck .env.local or your deployment configuration.`
    );
  }

  return result.data;
}

// Validate at module load; cache the result
let _env: Env | undefined;

export function env(): Env {
  if (!_env) {
    _env = validateEnv();
  }
  return _env;
}

// Reset cache (for testing)
export function _resetEnvCache(): void {
  _env = undefined;
}
