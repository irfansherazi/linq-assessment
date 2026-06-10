/**
 * POST /api/auth/signup — create a new recruiter account
 */
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { userRepository } from "@/repositories/user.repository";
import { signupApiSchema } from "@/validators/auth";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { ValidationError, ConflictError } from "@/lib/errors";
import { audit } from "@/services/audit";
import { authLogger } from "@/lib/logger";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = signupApiSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid signup data", parsed.error.flatten());
  }

  const { name, email, password } = parsed.data;

  // Check for existing account
  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new ConflictError("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await userRepository.create({ name, email, passwordHash });

  await audit.record({
    actorId: user.id,
    action: "USER_CREATED",
    entityType: "User",
    entityId: user.id,
    metadata: { email, name },
  });

  authLogger.info({ msg: "New user registered", userId: user.id, email });

  return successResponse(
    { id: user.id, name: user.name, email: user.email },
    { status: 201 }
  );
});
