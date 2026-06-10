/**
 * POST /api/auth/forgot-password — initiate a password reset
 *
 * Security: always returns 200 regardless of whether the email exists
 * (prevents email enumeration attacks).
 */
import type { NextRequest } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { userRepository } from "@/repositories/user.repository";
import { forgotPasswordSchema } from "@/validators/auth";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { ValidationError } from "@/lib/errors";
import { authLogger } from "@/lib/logger";

const TOKEN_EXPIRY_HOURS = 1;

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid data", parsed.error.flatten());
  }

  const { email } = parsed.data;
  const user = await userRepository.findByEmail(email);

  // Always return 200 to prevent email enumeration
  if (!user) {
    authLogger.warn({ msg: "Password reset for unknown email", email });
    return successResponse({ message: "If an account exists, a reset link has been sent." });
  }

  // Generate a secure random token and hash it for storage
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = await bcrypt.hash(rawToken, 10);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await userRepository.createPasswordResetToken({
    token: hashedToken,
    userId: user.id,
    expiresAt,
  });

  // In production: send email with reset link containing rawToken
  // For this demo, we log the token (no email service configured)
  authLogger.info({
    msg: "Password reset token created",
    userId: user.id,
    // In production: remove this log and send via email
    _devToken: process.env.NODE_ENV !== "production" ? rawToken : "[REDACTED]",
  });

  return successResponse({
    message: "If an account exists, a reset link has been sent.",
    // Expose token in dev for testing
    ...(process.env.NODE_ENV !== "production" ? { _devToken: rawToken } : {}),
  });
});
