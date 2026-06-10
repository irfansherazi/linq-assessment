/**
 * Audit service — append-only log of every significant system action.
 * Never throws — audit failures must NEVER break the calling operation.
 */
import { auditLogRepository } from "@/repositories/audit-log.repository";
import type { CreateAuditLogInput } from "@/repositories/audit-log.repository";
import { logger } from "@/lib/logger";

const auditLogger = logger.child({ subsystem: "audit" });

export const audit = {
  async record(input: CreateAuditLogInput): Promise<void> {
    try {
      await auditLogRepository.create(input);
    } catch (err) {
      auditLogger.error({
        msg: "Failed to write audit log",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async candidateCreated(actorId: string, candidateId: string, metadata?: Record<string, unknown>) {
    return this.record({
      actorId,
      candidateId,
      action: "CANDIDATE_CREATED",
      entityType: "Candidate",
      entityId: candidateId,
      metadata,
    });
  },

  async screeningStarted(candidateId: string, screeningId: string, actorId?: string, candidateName?: string) {
    return this.record({
      actorId,
      candidateId,
      candidateName,
      action: "SCREENING_STARTED",
      entityType: "Screening",
      entityId: screeningId,
    });
  },

  async screeningCompleted(candidateId: string, screeningId: string, candidateName?: string) {
    return this.record({
      candidateId,
      candidateName,
      action: "SCREENING_COMPLETED",
      entityType: "Screening",
      entityId: screeningId,
    });
  },

  async screeningFailed(candidateId: string, screeningId: string, reason: string, candidateName?: string) {
    return this.record({
      candidateId,
      candidateName,
      action: "SCREENING_FAILED",
      entityType: "Screening",
      entityId: screeningId,
      metadata: { reason },
    });
  },

  async messageSent(messageId: string, candidateId: string | null, metadata?: Record<string, unknown>) {
    return this.record({
      candidateId: candidateId ?? undefined,
      action: "MESSAGE_SENT",
      entityType: "Message",
      entityId: messageId,
      metadata,
    });
  },

  async messageFailed(messageId: string, candidateId: string | null, errorCode?: string, errorReason?: string) {
    return this.record({
      candidateId: candidateId ?? undefined,
      action: "MESSAGE_FAILED",
      entityType: "Message",
      entityId: messageId,
      metadata: { errorCode, errorReason },
    });
  },

  async messageReceived(messageId: string, candidateId: string, metadata?: Record<string, unknown>) {
    return this.record({
      candidateId,
      action: "MESSAGE_RECEIVED",
      entityType: "Message",
      entityId: messageId,
      metadata,
    });
  },

  async retrySucceeded(messageId: string, candidateId: string | null, attempt: number) {
    return this.record({
      candidateId: candidateId ?? undefined,
      action: "RETRY_SUCCEEDED",
      entityType: "Message",
      entityId: messageId,
      metadata: { attempt },
    });
  },

  async retryEnqueued(messageId: string, candidateId: string | null, attempt: number) {
    return this.record({
      candidateId: candidateId ?? undefined,
      action: "RETRY_ENQUEUED",
      entityType: "Message",
      entityId: messageId,
      metadata: { attempt },
    });
  },

  async retryDeadLettered(messageId: string, candidateId: string | null, totalAttempts: number) {
    return this.record({
      candidateId: candidateId ?? undefined,
      action: "RETRY_DEAD_LETTERED",
      entityType: "Message",
      entityId: messageId,
      metadata: { totalAttempts },
    });
  },

  async webhookProcessed(webhookEventId: string, eventType: string) {
    return this.record({
      action: "WEBHOOK_PROCESSED",
      entityType: "WebhookEvent",
      entityId: webhookEventId,
      metadata: { eventType },
    });
  },

  async webhookFailed(webhookEventId: string, eventType: string, error: string) {
    return this.record({
      action: "WEBHOOK_FAILED",
      entityType: "WebhookEvent",
      entityId: webhookEventId,
      metadata: { eventType, error },
    });
  },
};
