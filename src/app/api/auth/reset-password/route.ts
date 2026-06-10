/**
 * POST /api/auth/reset-password — complete a password reset
 */
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { userRepository } from "@/repositories/user.repository";
import { resetPasswordSchema } from "@/validators/auth";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { authLogger } from "@/lib/logger";
import { audit } from "@/services/audit";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid data", parsed.error.flatten());
  }

  const { token: rawToken, password } = parsed.data;

  // Find all recent unused tokens and compare against each
  // (We can't look up by raw token since we store a hash — iterate recent tokens)
  // Better: store a secondary lookup key. For simplicity, find tokens by brute force
  // since there's at most one active token per user.
  // NOTE: In production, use a more efficient lookup (e.g., store a non-hashed index).

  // For the demo, we search recent tokens
  const recentTokens = await import("@/lib/db").then(({ db }) =>
    db.passwordResetToken.findMany({
      where: {
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    })
  );

  let validRecord: typeof recentTokens[0] | null = null;
  for (const record of recentTokens) {
    const isMatch = await bcrypt.compare(rawToken, record.token);
    if (isMatch) {
      validRecord = record;
      break;
    }
  }

  if (!validRecord) {
    throw new NotFoundError("Password reset token");
  }

  const newPasswordHash = await bcrypt.hash(password, 12);

  await userRepository.updatePassword(validRecord.userId, newPasswordHash);
  await userRepository.markPasswordResetTokenUsed(validRecord.id);

  await audit.record({
    actorId: validRecord.userId,
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "User",
    entityId: validRecord.userId,
  });

  authLogger.info({ msg: "Password reset completed", userId: validRecord.userId });

  return successResponse({ message: "Password reset successfully. You can now log in." });
});
