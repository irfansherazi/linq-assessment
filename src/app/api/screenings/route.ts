/**
 * POST /api/screenings — launch a screening for a candidate
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { candidateRepository } from "@/repositories/candidate.repository";
import { screeningRepository } from "@/repositories/screening.repository";
import { workflowEngine } from "@/services/screening/workflow-engine";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  BusinessLogicError,
} from "@/lib/errors";
import { db } from "@/lib/db";

const launchScreeningSchema = z.object({
  candidateId: z.string().cuid(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const body = await req.json();
  const parsed = launchScreeningSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid data", parsed.error.flatten());
  }

  const { candidateId } = parsed.data;

  // Verify candidate belongs to this recruiter
  const candidate = await candidateRepository.findById(
    candidateId,
    session.user.id
  );
  if (!candidate) throw new NotFoundError("Candidate", candidateId);

  // Check for existing active screening
  const existingScreening =
    await screeningRepository.findActiveForCandidate(candidateId);
  if (existingScreening && existingScreening.state !== "PENDING") {
    throw new BusinessLogicError(
      `Candidate already has an active screening (state: ${existingScreening.state})`,
      "SCREENING_ALREADY_STARTED"
    );
  }

  // Ensure screening questions exist
  const questionCount = await screeningRepository.countActiveQuestions();
  if (questionCount === 0) {
    throw new BusinessLogicError(
      "No active screening questions configured",
      "BUSINESS_LOGIC_ERROR"
    );
  }

  // Reuse a stuck PENDING screening (intro SMS never sent) or create a new one
  const screening = existingScreening ?? await db.screening.create({
    data: {
      candidate: { connect: { id: candidateId } },
      state: "PENDING",
      currentQuestionIndex: 0,
    },
  });

  // Launch the screening (sends intro SMS)
  const result = await workflowEngine.startScreening(
    screening.id,
    session.user.id
  );

  return successResponse(
    {
      screeningId: result.screeningId,
      messageId: result.messageId,
      linqChatId: result.linqChatId,
      state: "STARTED",
    },
    { status: 201 }
  );
});
