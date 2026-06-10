/**
 * GET  /api/candidates — list candidates with search/filter/pagination
 * POST /api/candidates — create a new candidate
 */
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { candidateRepository } from "@/repositories/candidate.repository";
import { audit } from "@/services/audit";
import {
  createCandidateSchema,
  candidateQuerySchema,
} from "@/validators/candidate";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import {
  ValidationError,
  UnauthorizedError,
  DuplicateCandidateError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { searchParams } = req.nextUrl;
  const query = candidateQuerySchema.safeParse(
    Object.fromEntries(searchParams)
  );
  if (!query.success) {
    throw new ValidationError("Invalid query parameters", query.error.flatten());
  }

  const result = await candidateRepository.findMany({
    recruiterId: session.user.id,
    ...query.data,
  });

  return successResponse(result);
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const body = await req.json();
  const parsed = createCandidateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid candidate data", parsed.error.flatten());
  }

  const { name, phone, role, notes } = parsed.data;
  const recruiterId = session.user.id;

  // Duplicate prevention
  const existing = await candidateRepository.findByPhone(phone, recruiterId);
  if (existing && !existing.deletedAt) {
    throw new DuplicateCandidateError(phone);
  }

  const candidate = await candidateRepository.create({
    name,
    phone,
    role,
    notes,
    recruiter: { connect: { id: recruiterId } },
  });

  const requestId = req.headers.get("x-request-id") ?? undefined;
  await audit.candidateCreated(recruiterId, candidate.id, { name, phone, role, requestId });

  logger.info({
    msg: "Candidate created",
    candidateId: candidate.id,
    recruiterId,
    requestId,
  });

  return successResponse(candidate, { status: 201 });
});
