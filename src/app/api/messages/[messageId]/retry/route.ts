/**
 * POST /api/messages/:messageId/retry — manually re-queue a failed message.
 *
 * Resets (or creates) the retry job at attempt 1 and marks the message QUEUED,
 * bypassing the automatic exhaustion check so the user can always force a retry.
 *
 * After queuing, the retry processor is run inline so the resend fires
 * immediately instead of waiting for the next Vercel Cron tick (which never
 * fires during local `next dev`). The job's nextRunAt is `now`, so the
 * in-process call to processDueJobs() claims and sends it right away.
 */
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { retryJobRepository } from "@/repositories/retry-job.repository";
import { messageRepository } from "@/repositories/message.repository";
import { retryService } from "@/services/retry";
import { retryLogger } from "@/lib/logger";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { UnauthorizedError, NotFoundError, BusinessLogicError } from "@/lib/errors";

const MAX_ATTEMPTS = 5;

type Ctx = { params: Promise<{ messageId: string }> };

export const POST = withErrorHandler(async (_req: NextRequest, ctx?: Ctx) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { messageId } = await ctx!.params;

  // Verify the message exists and belongs to this recruiter's candidate
  const message = await db.message.findFirst({
    where: {
      id: messageId,
      conversation: { candidate: { recruiterId: session.user.id } },
    },
    select: { id: true, status: true },
  });

  if (!message) throw new NotFoundError("Message", messageId);

  if (message.status !== "FAILED") {
    throw new BusinessLogicError(
      `Message ${messageId} is not in FAILED state (status: ${message.status})`
    );
  }

  const existing = await retryJobRepository.findLatestByMessageId(messageId);

  if (existing) {
    // resetForManualRetry: sets attempt=1, status=PENDING, nextRunAt=now, lastError=null
    await retryJobRepository.resetForManualRetry(existing.id);
  } else {
    await retryJobRepository.create({
      message: { connect: { id: messageId } },
      attempt: 1,
      maxAttempts: MAX_ATTEMPTS,
      nextRunAt: new Date(),
      status: "PENDING",
    });
  }

  // Mark message as QUEUED so the UI reflects that it's pending a retry, and
  // clear the prior failure state so the message list doesn't keep showing the
  // old "delivery failed" reason while it's queued.
  await messageRepository.updateStatus(messageId, "QUEUED", {
    errorCode: null,
    errorReason: null,
    failedAt: null,
  });

  // Process the job inline so the resend fires immediately rather than waiting
  // for the cron. Any per-job failure is already handled inside processDueJobs
  // (reschedule/dead-letter), so a thrown error here only signals an
  // infrastructure problem with claiming jobs — don't fail the whole request
  // since the job is already queued and the cron will pick it up.
  let processed = false;
  try {
    const result = await retryService.processDueJobs();
    processed = result.processed > 0;
  } catch (err) {
    retryLogger.error({
      msg: "Inline retry processing failed after manual enqueue; job remains queued for cron",
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return successResponse({ messageId, queued: true, processed });
});
