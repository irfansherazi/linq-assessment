/**
 * RetryJob repository — manages the retry queue for failed message sends.
 *
 * The cron processor claims jobs atomically (PENDING → IN_PROGRESS)
 * to prevent double-processing in concurrent invocations.
 */
import { Prisma } from "@/generated/prisma";
import type { RetryJob, RetryJobStatus } from "@/generated/prisma";
import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams } from "@/types";

export const retryJobRepository = {
  async findById(id: string): Promise<RetryJob | null> {
    return db.retryJob.findUnique({ where: { id } });
  },

  async findByMessageId(messageId: string): Promise<RetryJob | null> {
    return db.retryJob.findFirst({
      where: { messageId, status: { in: ["PENDING", "IN_PROGRESS"] } },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Find the most recent retry job for a message regardless of status.
   * Used by enqueue() to resume the attempt counter across the
   * webhook → cron → webhook cycle (a resend that Linq accepts gets
   * marked SUCCEEDED, but its delivery may still fail later).
   */
  async findLatestByMessageId(messageId: string): Promise<RetryJob | null> {
    return db.retryJob.findFirst({
      where: { messageId },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Claim up to `limit` due jobs atomically using SELECT … FOR UPDATE SKIP LOCKED.
   *
   * A plain find-then-updateMany lets two concurrent Lambda invocations read
   * the same PENDING rows before either has written IN_PROGRESS, causing both
   * to process the same jobs. SKIP LOCKED means a second Lambda skips any row
   * already locked by the first, so each job is claimed by exactly one worker.
   *
   * Also resets IN_PROGRESS jobs that have been stuck for > 5 minutes
   * (Lambda crash / hard timeout — maxDuration is 60 s).
   */
  async claimDueJobs(limit = 10): Promise<RetryJob[]> {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

    // Recover stale claims before picking up new work
    await db.retryJob.updateMany({
      where: { status: "IN_PROGRESS", updatedAt: { lte: staleThreshold } },
      data: { status: "PENDING" },
    });

    // All DateTime columns are `timestamptz` (see schema.prisma), so comparing
    // `nextRunAt` against `NOW()` (also timestamptz) is an absolute-instant
    // comparison and is correct regardless of the database session timezone.
    const claimed = await db.$queryRaw<RetryJob[]>(
      Prisma.sql`
        UPDATE "RetryJob"
        SET    status      = 'IN_PROGRESS'::"RetryJobStatus",
               "runAt"    = NOW(),
               "updatedAt" = NOW()
        WHERE  id IN (
          SELECT id FROM "RetryJob"
          WHERE  status     = 'PENDING'::"RetryJobStatus"
            AND  "nextRunAt" <= NOW()
          ORDER BY "nextRunAt" ASC
          LIMIT  ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `
    );

    return claimed;
  },

  async create(data: Prisma.RetryJobCreateInput): Promise<RetryJob> {
    return db.retryJob.create({ data });
  },

  async markSucceeded(id: string): Promise<RetryJob> {
    return db.retryJob.update({
      where: { id },
      data: { status: "SUCCEEDED", runAt: new Date() },
    });
  },

  async reschedule(
    id: string,
    nextRunAt: Date,
    attempt: number,
    lastError?: string
  ): Promise<RetryJob> {
    return db.retryJob.update({
      where: { id },
      data: { status: "PENDING", nextRunAt, attempt, lastError },
    });
  },

  async markDeadLetter(id: string, lastError?: string): Promise<RetryJob> {
    return db.retryJob.update({
      where: { id },
      data: { status: "DEAD_LETTER", lastError },
    });
  },

  async resetForManualRetry(id: string): Promise<RetryJob> {
    return db.retryJob.update({
      where: { id },
      data: {
        status: "PENDING",
        attempt: 1,
        nextRunAt: new Date(),
        lastError: null,
      },
    });
  },

  async findMany(
    params: PaginationParams & { status?: RetryJobStatus } = {}
  ): Promise<PaginatedResult<RetryJob & { message: import("@/generated/prisma").Message }>> {
    const { page = 1, limit = 50, status } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.RetryJobWhereInput = {
      ...(status ? { status } : {}),
    };

    const [data, total] = await db.$transaction([
      db.retryJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          message: {
            include: {
              conversation: {
                include: {
                  candidate: { select: { id: true, name: true, phone: true } },
                },
              },
            },
          },
        },
      }),
      db.retryJob.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + data.length < total,
      },
    };
  },

  async countDeadLetters(): Promise<number> {
    return db.retryJob.count({ where: { status: "DEAD_LETTER" } });
  },

  async countPending(): Promise<number> {
    return db.retryJob.count({ where: { status: "PENDING" } });
  },
};
