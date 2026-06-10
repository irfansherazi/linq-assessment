/**
 * Webhook event dispatcher.
 *
 * Routes incoming Linq webhook events to their handlers.
 * Each handler is isolated — a failure in one does NOT affect others.
 *
 * Event type coverage:
 * - message.sent     → update message status to SENT
 * - message.failed   → update status to FAILED, enqueue retry
 * - message.received → update status to RECEIVED, invoke screening engine
 * - message.delivered → update deliveredAt (iMessage/RCS only)
 * - message.read     → update readAt (iMessage only)
 * - (others)         → log + ignore (future extensibility)
 */
import { webhookLogger } from "@/lib/logger";
import { messageRepository } from "@/repositories/message.repository";
import { retryService } from "@/services/retry";
import { workflowEngine } from "@/services/screening/workflow-engine";
import { audit } from "@/services/audit";
import { publishEvent } from "@/lib/kv";
import { db } from "@/lib/db";
import type { WebhookDispatchContext } from "@/types";
import type { LinqMessageEventData } from "@/lib/linq/types";

const log = webhookLogger.child({ subsystem: "dispatch" });

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Look up the recruiter who owns the conversation and publish a real-time event.
 * Non-fatal — KV failures never break webhook processing.
 */
async function notifyRecruiter(
  conversationId: string,
  event: Omit<Parameters<typeof publishEvent>[1], "candidateId">
): Promise<void> {
  try {
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { candidateId: true, candidate: { select: { recruiterId: true } } },
    });
    if (!conversation) return;
    await publishEvent(conversation.candidate.recruiterId, {
      ...event,
      candidateId: conversation.candidateId,
    });
  } catch { /* non-fatal */ }
}

export async function dispatchWebhookEvent(
  ctx: WebhookDispatchContext
): Promise<void> {
  const { eventType, data, eventId } = ctx;

  log.debug({ msg: "Dispatching webhook event", eventType, eventId });

  switch (eventType) {
    case "message.sent":
      return handleMessageSent(data as unknown as LinqMessageEventData);

    case "message.failed":
      return handleMessageFailed(data as unknown as LinqMessageEventData);

    case "message.received":
      return handleMessageReceived(data as unknown as LinqMessageEventData);

    case "message.delivered":
      return handleMessageDelivered(data as unknown as LinqMessageEventData);

    case "message.read":
      return handleMessageRead(data as unknown as LinqMessageEventData);

    default:
      // Log unknown/unhandled events but don't error — forward compatibility
      log.info({
        msg: "Unhandled webhook event type",
        eventType,
        eventId,
      });
  }
}

// ── Handler: message.sent ────────────────────────────────────────────────────

async function handleMessageSent(data: LinqMessageEventData): Promise<void> {
  const linqMessageId = data.id;
  if (!linqMessageId) {
    log.warn({ msg: "message.sent webhook missing message id" });
    return;
  }

  const message = await messageRepository.findByLinqMessageId(linqMessageId);
  if (!message) {
    log.warn({
      msg: "message.sent: no local message found",
      linqMessageId,
    });
    return;
  }

  await messageRepository.updateStatus(message.id, "SENT", {
    sentAt: data.sent_at ? new Date(data.sent_at) : new Date(),
  });

  await messageRepository.createEvent({
    message: { connect: { id: message.id } },
    status: "SENT",
    metadata: { linqMessageId, webhook: "message.sent" },
  });

  await audit.messageSent(message.id, message.conversation.candidateId, { webhook: "message.sent", linqMessageId });

  await notifyRecruiter(message.conversationId, { type: "message.sent", linqMessageId });

  log.info({ msg: "Message marked SENT", messageId: message.id, linqMessageId });
}

// ── Handler: message.failed ──────────────────────────────────────────────────

async function handleMessageFailed(data: LinqMessageEventData): Promise<void> {
  // message.failed payload uses flat message_id/chat_id; other events use nested id/chat.id
  const linqMessageId = data.message_id ?? data.id;
  if (!linqMessageId) {
    log.warn({ msg: "message.failed webhook missing message id" });
    return;
  }

  const message = await messageRepository.findByLinqMessageId(linqMessageId);
  if (!message) {
    log.warn({
      msg: "message.failed: no local message found",
      linqMessageId,
    });
    return;
  }

  const errorCode = String(data.code ?? "UNKNOWN");
  const errorReason = data.reason ?? "Delivery failed";

  await messageRepository.updateStatus(message.id, "FAILED", {
    errorCode,
    errorReason,
    failedAt: new Date(),
  });

  await messageRepository.createEvent({
    message: { connect: { id: message.id } },
    status: "FAILED",
    metadata: { linqMessageId, errorCode, errorReason, webhook: "message.failed" },
  });

  // Enqueue retry
  await retryService.enqueue({ messageId: message.id, candidateId: message.conversation.candidateId });

  await audit.messageFailed(message.id, message.conversation.candidateId, errorCode, errorReason);
  await notifyRecruiter(message.conversationId, { type: "message.failed", linqMessageId });

  log.warn({
    msg: "Message failed — retry enqueued",
    messageId: message.id,
    linqMessageId,
    errorCode,
    errorReason,
  });
}

// ── Handler: message.received ────────────────────────────────────────────────

async function handleMessageReceived(
  data: LinqMessageEventData
): Promise<void> {
  const linqChatId = data.chat?.id;
  const linqMessageId = data.id;
  const textPart = data.parts?.find((p) => p.type === "text");
  const replyText = textPart?.value ?? "";

  if (!linqChatId) {
    log.warn({ msg: "message.received webhook missing chat.id" });
    return;
  }

  log.info({
    msg: "Inbound message received",
    linqChatId,
    linqMessageId,
    textPreview: replyText.slice(0, 50),
  });

  await workflowEngine.handleInboundReply(
    linqChatId,
    replyText,
    linqMessageId
  );

  // Notify dashboard — look up via linqChatId
  const conversation = await db.conversation.findUnique({
    where: { linqChatId },
    select: { id: true, candidateId: true, candidate: { select: { recruiterId: true } } },
  });
  if (conversation) {
    await publishEvent(conversation.candidate.recruiterId, {
      type: "message.received",
      candidateId: conversation.candidateId,
    });
  }
}

// ── Handler: message.delivered ───────────────────────────────────────────────

async function handleMessageDelivered(
  data: LinqMessageEventData
): Promise<void> {
  // NOTE: This only fires for iMessage/RCS — not for SMS.
  // We keep this handler for future-proofing when Linq supports iMessage.
  const linqMessageId = data.id;
  if (!linqMessageId) return;

  const message = await messageRepository.findByLinqMessageId(linqMessageId);
  if (!message) return;

  await messageRepository.updateStatus(message.id, "DELIVERED", {
    deliveredAt: data.delivered_at ? new Date(data.delivered_at) : new Date(),
  });

  await messageRepository.createEvent({
    message: { connect: { id: message.id } },
    status: "DELIVERED",
    metadata: { linqMessageId, webhook: "message.delivered" },
  });

  log.info({ msg: "Message marked DELIVERED", messageId: message.id, linqMessageId });
}

// ── Handler: message.read ────────────────────────────────────────────────────

async function handleMessageRead(data: LinqMessageEventData): Promise<void> {
  // iMessage only
  const linqMessageId = data.id;
  if (!linqMessageId) return;

  const message = await messageRepository.findByLinqMessageId(linqMessageId);
  if (!message) return;

  await messageRepository.updateStatus(message.id, "READ", {
    readAt: new Date(),
  });

  await messageRepository.createEvent({
    message: { connect: { id: message.id } },
    status: "READ",
    metadata: { linqMessageId, webhook: "message.read" },
  });
}
