/**
 * GET    /api/candidates/:id  — get candidate with full details
 * PATCH  /api/candidates/:id  — update candidate
 * DELETE /api/candidates/:id  — soft-delete candidate
 */
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { candidateRepository } from "@/repositories/candidate.repository";
import { updateCandidateSchema } from "@/validators/candidate";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} from "@/lib/errors";
import { audit } from "@/services/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (req: NextRequest, ctx?: Ctx) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { id } = await ctx!.params;
  const candidate = await candidateRepository.findByIdWithDetails(
    id,
    session.user.id
  );

  if (!candidate) throw new NotFoundError("Candidate", id);

  return successResponse(candidate);
});

export const PATCH = withErrorHandler(async (req: NextRequest, ctx?: Ctx) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { id } = await ctx!.params;
  const candidate = await candidateRepository.findById(id, session.user.id);
  if (!candidate) throw new NotFoundError("Candidate", id);
  if (candidate.recruiterId !== session.user.id) throw new ForbiddenError();

  const body = await req.json();
  const parsed = updateCandidateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid update data", parsed.error.flatten());
  }

  const updated = await candidateRepository.update(
    id,
    session.user.id,
    parsed.data
  );

  await audit.record({
    actorId: session.user.id,
    candidateId: id,
    candidateName: candidate.name,
    action: "CANDIDATE_UPDATED",
    entityType: "Candidate",
    entityId: id,
    metadata: parsed.data,
  });

  return successResponse(updated);
});

export const DELETE = withErrorHandler(async (req: NextRequest, ctx?: Ctx) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { id } = await ctx!.params;
  const candidate = await candidateRepository.findById(id, session.user.id);
  if (!candidate) throw new NotFoundError("Candidate", id);
  if (candidate.recruiterId !== session.user.id) throw new ForbiddenError();

  await candidateRepository.hardDelete(id);

  await audit.record({
    actorId: session.user.id,
    candidateName: candidate.name,
    action: "CANDIDATE_DELETED",
    entityType: "Candidate",
    entityId: id,
  });

  return successResponse({ deleted: true });
});
