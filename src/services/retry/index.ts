/**
 * Retry service — manages failed message retry jobs.
 *
 * Responsibilities:
 * - Enqueue a RetryJob when a message send fails
 * - Process due jobs (used by the cron API route)
 * - Handle exhaustion → DEAD_LETTER
 *
 * The cron processor claims jobs atomically to prevent double-processing
 * in concurrent Lambda invocations (see retryJobRepository.claimDueJobs).
 */
import { retryJobRepository } from "@/repositories/retry-job.repository";
import { messageRepository } from "@/repositories/message.repository";
import { getMessagingProvider } from "@/services/messaging/linq-provider";
import { audit } from "@/services/audit";
import { retryLogger } from "@/lib/logger";
import { LinqRateLimitError } from "@/lib/errors";
import {
  computeNextRunAt,
  computeNextRunAtWithRateLimit,
  isExhausted,
} from "./backoff";
import type { Message } from "@/generated/prisma";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;

export interface EnqueueRetryOptions {
  messageId: string;
  candidateId?: string;
  /** If set (Linq 429), honor it for the first retry delay */
  retryAfterSeconds?: number;
}

export interface RetryProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
}

export const retryService = {
  /**
   * Enqueue a retry job for a failed message.
   * Called when a message send returns FAILED status or throws.
   */
  async enqueue(options: EnqueueRetryOptions): Promise<void> {
    const { messageId, candidateId, retryAfterSeconds } = options;

    // Resume the attempt counter from the message's most recent retry job.
    // Linq reports delivery failures asynchronously via webhook, so each
    // failure calls enqueue() — without this, every failure would start a
    // fresh 1/5 cycle and the message would never reach DEAD_LETTER.
    const existing = await retryJobRepository.findLatestByMessageId(messageId);

    // A job already waiting to run — don't stack a duplicate on top of it.
    if (existing && (existing.status === "PENDING" || existing.status === "IN_PROGRESS")) {
      retryLogger.info({
        msg: "Retry job already active for message; skipping duplicate enqueue",
        messageId,
        jobId: existing.id,
        attempt: existing.attempt,
      });
      return;
    }

    const attempt = existing ? existing.attempt + 1 : 1;

    // Already exhausted across prior cycles → dead-letter, don't re-queue.
    if (isExhausted(attempt, { maxAttempts: MAX_ATTEMPTS })) {
      retryLogger.warn({
        msg: "Retry attempts exhausted; dead-lettering instead of enqueueing",
        messageId,
        attempt,
      });
      if (existing) {
        await retryJobRepository.markDeadLetter(
          existing.id,
          `Exhausted ${MAX_ATTEMPTS} retry attempts after repeated delivery failures`
        );
      }
      await messageRepository.updateStatus(messageId, "FAILED", {
        errorReason: `Exhausted ${MAX_ATTEMPTS} retry attempts after repeated delivery failures`,
        failedAt: new Date(),
      });
      await audit.retryDeadLettered(messageId, candidateId ?? null, MAX_ATTEMPTS);
      return;
    }

    retryLogger.info({
      msg: "Enqueueing retry job",
      messageId,
      attempt,
      retryAfterSeconds,
    });

    const nextRunAt = retryAfterSeconds
      ? computeNextRunAtWithRateLimit(attempt, retryAfterSeconds)
      : computeNextRunAt(attempt);

    if (existing) {
      // Continue the same job's lifecycle (it was SUCCEEDED/DEAD_LETTER from
      // a prior cycle); reschedule re-opens it as PENDING at the next attempt.
      await retryJobRepository.reschedule(existing.id, nextRunAt, attempt);
    } else {
      await retryJobRepository.create({
        message: { connect: { id: messageId } },
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        nextRunAt,
        status: "PENDING",
      });
    }

    await audit.retryEnqueued(messageId, candidateId ?? null, attempt);
  },

  /**
   * Process all due retry jobs.
   * Called by the cron route on a schedule.
   */
  async processDueJobs(): Promise<RetryProcessResult> {
    const result: RetryProcessResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      deadLettered: 0,
    };

    const jobs = await retryJobRepository.claimDueJobs(BATCH_SIZE);

    retryLogger.info({
      msg: "Processing retry jobs",
      count: jobs.length,
    });

    for (const job of jobs) {
      result.processed++;
      let message: Awaited<ReturnType<typeof messageRepository.findById>> | undefined;

      try {
        message = await messageRepository.findById(job.messageId);
        if (!message) {
          retryLogger.warn({
            msg: "Message not found for retry job",
            jobId: job.id,
            messageId: job.messageId,
          });
          await retryJobRepository.markDeadLetter(
            job.id,
            "Message record not found"
          );
          result.deadLettered++;
          continue;
        }

        await this._retryMessage(job, message);
        result.succeeded++;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);

        retryLogger.error({
          msg: "Retry job failed",
          jobId: job.id,
          messageId: job.messageId,
          attempt: job.attempt,
          error: errorMessage,
        });

        const nextAttempt = job.attempt + 1;

        if (isExhausted(nextAttempt, { maxAttempts: MAX_ATTEMPTS })) {
          // Exhausted all attempts → dead letter
          await retryJobRepository.markDeadLetter(job.id, errorMessage);
          await messageRepository.updateStatus(job.messageId, "FAILED", {
            errorReason: `Exhausted ${MAX_ATTEMPTS} retry attempts. Last error: ${errorMessage}`,
            failedAt: new Date(),
          });
          await audit.retryDeadLettered(job.messageId, message?.conversation?.candidateId ?? null, MAX_ATTEMPTS);
          result.deadLettered++;
        } else {
          // Schedule next attempt
          let nextRunAt: Date;
          if (err instanceof LinqRateLimitError) {
            nextRunAt = computeNextRunAtWithRateLimit(
              nextAttempt,
              err.retryAfterSeconds
            );
          } else {
            nextRunAt = computeNextRunAt(nextAttempt);
          }

          await retryJobRepository.reschedule(
            job.id,
            nextRunAt,
            nextAttempt,
            errorMessage
          );
          result.failed++;
        }
      }
    }

    retryLogger.info({
      msg: "Retry batch complete",
      ...result,
    });

    return result;
  },

  async _retryMessage(
    job: import("@/generated/prisma").RetryJob,
    message: Message & { conversation: { candidateId: string } | null }
  ): Promise<void> {
    retryLogger.info({
      msg: "Attempting message retry",
      jobId: job.id,
      messageId: message.id,
      attempt: job.attempt,
    });

    const { db } = await import("@/lib/db");
    const conv = await db.conversation.findUnique({
      where: { id: message.conversationId },
    });

    if (!conv) {
      throw new Error(
        `No conversation found for message ${message.id}`
      );
    }

    // Get the candidate phone number
    const candidate = await db.candidate.findUnique({
      where: { id: conv.candidateId },
      select: { phone: true },
    });

    if (!candidate) {
      throw new Error(`No candidate found for conversation ${conv.id}`);
    }

    const provider = getMessagingProvider();
    const fromPhone = process.env.LINQ_FROM_PHONE!;

    // Use an attempt-scoped idempotency key so Linq treats each retry as a
    // distinct send (not a dedup of the original). The original key was already
    // consumed when the first send was accepted; reusing it would cause Linq to
    // return a cached success without actually re-sending the message.
    const retryIdempotencyKey = `${message.idempotencyKey ?? message.id}-r${job.attempt}`;

    const sendResult = await provider.sendMessage({
      linqChatId: conv.linqChatId,
      to: candidate.phone,
      from: fromPhone,
      body: message.body,
      idempotencyKey: retryIdempotencyKey,
    });

    // A synchronous FAILED status from Linq means the send was rejected outright
    // (e.g. invalid number, account suspended). Treat it as a hard failure so
    // the retry counter increments and the job is rescheduled or dead-lettered.
    if (sendResult.status === "FAILED") {
      throw new Error(
        `Linq rejected retry send synchronously (linqMessageId: ${sendResult.linqMessageId ?? "none"})`
      );
    }

    await messageRepository.updateStatus(message.id, sendResult.status, {
      linqMessageId: sendResult.linqMessageId,
      // Only record sentAt when Linq has actually accepted the message
      sentAt: new Date(),
      // Clear the failure state from the prior attempt — otherwise the message
      // keeps showing the old "delivery failed" reason even though the resend
      // was accepted. A subsequent delivery failure re-populates these via the
      // message.failed webhook.
      errorCode: null,
      errorReason: null,
      failedAt: null,
    });

    await messageRepository.createEvent({
      message: { connect: { id: message.id } },
      status: sendResult.status,
      metadata: {
        event: "retry_sent",
        attempt: job.attempt,
        linqMessageId: sendResult.linqMessageId,
      },
    });

    await retryJobRepository.markSucceeded(job.id);
    await audit.retrySucceeded(message.id, conv.candidateId, job.attempt);

    retryLogger.info({
      msg: "Retry succeeded",
      jobId: job.id,
      messageId: message.id,
      attempt: job.attempt,
      newLinqMessageId: sendResult.linqMessageId,
    });
  },
};
