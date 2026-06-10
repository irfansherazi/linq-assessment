/**
 * GET /api/dashboard — aggregated metrics for the dashboard page
 */
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { candidateRepository } from "@/repositories/candidate.repository";
import { screeningRepository } from "@/repositories/screening.repository";
import { messageRepository } from "@/repositories/message.repository";
import { auditLogRepository } from "@/repositories/audit-log.repository";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { UnauthorizedError } from "@/lib/errors";

export const GET = withErrorHandler(async (_req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const recruiterId = session.user.id;

  // Fetch all metrics in parallel
  const [candidateCounts, screeningCounts, failedMessages, recentActivity] =
    await Promise.all([
      candidateRepository.countByStatus(recruiterId),
      screeningRepository.countByState(recruiterId),
      messageRepository.countFailedMessages(recruiterId),
      auditLogRepository.findRecent(20, recruiterId),
    ]);

  const activeScreenings =
    screeningCounts.STARTED +
    screeningCounts.QUESTION_1 +
    screeningCounts.QUESTION_2 +
    screeningCounts.QUESTION_3 +
    screeningCounts.QUESTION_4;

  const MESSAGE_ACTIONS = new Set(["MESSAGE_SENT", "MESSAGE_RECEIVED", "MESSAGE_DELIVERED", "MESSAGE_FAILED"]);
  const filteredActivity = recentActivity.filter((log) => !MESSAGE_ACTIONS.has(log.action));

  return successResponse({
    metrics: {
      totalCandidates:
        candidateCounts.PENDING +
        candidateCounts.SCREENING +
        candidateCounts.COMPLETED +
        candidateCounts.FAILED +
        candidateCounts.WITHDRAWN,
      activeScreenings,
      completedScreenings: screeningCounts.COMPLETED,
      failedDeliveries: failedMessages,
    },
    recentActivity: filteredActivity,
  });
});
