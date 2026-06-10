/**
 * POST /api/retries/:jobId/retry — manually re-queue a dead-lettered retry job.
 */
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { retryJobRepository } from "@/repositories/retry-job.repository";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { UnauthorizedError, NotFoundError, BusinessLogicError } from "@/lib/errors";

type Ctx = { params: Promise<{ jobId: string }> };

export const POST = withErrorHandler(async (_req: NextRequest, ctx?: Ctx) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { jobId } = await ctx!.params;
  const job = await retryJobRepository.findById(jobId);

  if (!job) throw new NotFoundError("RetryJob", jobId);
  if (job.status !== "DEAD_LETTER") {
    throw new BusinessLogicError(
      `Job ${jobId} is not dead-lettered (status: ${job.status})`
    );
  }

  const updated = await retryJobRepository.resetForManualRetry(jobId);

  return successResponse(updated);
});
