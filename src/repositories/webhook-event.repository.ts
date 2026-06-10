/**
 * WebhookEvent repository — idempotency store for Linq webhook events.
 *
 * The linqEventId (from the webhook-id header) is the idempotency key.
 * findOrCreate returns {event, created} so callers can skip if !created.
 */
import { Prisma } from "@/generated/prisma";
import type { WebhookEvent, WebhookEventStatus } from "@/generated/prisma";
import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams } from "@/types";

export interface WebhookEventWithCandidate extends WebhookEvent {
  candidate: { id: string; name: string; phone: string } | null;
}

export const webhookEventRepository = {
  async findByLinqEventId(
    linqEventId: string
  ): Promise<WebhookEvent | null> {
    return db.webhookEvent.findUnique({ where: { linqEventId } });
  },

  /**
   * Create the event record if it doesn't exist (idempotency gate).
   * Returns { event, created: true } if new, { event, created: false } if duplicate.
   */
  async findOrCreate(
    linqEventId: string,
    eventType: string,
    rawPayload: Prisma.InputJsonValue
  ): Promise<{ event: WebhookEvent; created: boolean }> {
    const existing = await db.webhookEvent.findUnique({
      where: { linqEventId },
    });

    if (existing) {
      return { event: existing, created: false };
    }

    const event = await db.webhookEvent.create({
      data: {
        linqEventId,
        eventType,
        rawPayload,
        status: "RECEIVED",
      },
    });

    return { event, created: true };
  },

  async markProcessing(id: string): Promise<WebhookEvent> {
    return db.webhookEvent.update({
      where: { id },
      data: { status: "PROCESSING" },
    });
  },

  async markProcessed(
    id: string,
    processedPayload?: Prisma.InputJsonValue
  ): Promise<WebhookEvent> {
    return db.webhookEvent.update({
      where: { id },
      data: {
        status: "PROCESSED",
        processedPayload,
        processedAt: new Date(),
      },
    });
  },

  async markFailed(id: string, errorMessage: string): Promise<WebhookEvent> {
    return db.webhookEvent.update({
      where: { id },
      data: { status: "FAILED", errorMessage },
    });
  },

  async markDuplicate(id: string): Promise<WebhookEvent> {
    return db.webhookEvent.update({
      where: { id },
      data: { status: "DUPLICATE" },
    });
  },

  async findMany(
    params: PaginationParams & {
      status?: WebhookEventStatus;
      eventType?: string;
    } = {}
  ): Promise<PaginatedResult<WebhookEventWithCandidate>> {
    const { page = 1, limit = 50, status, eventType } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.WebhookEventWhereInput = {
      ...(status ? { status } : {}),
      ...(eventType ? { eventType } : {}),
    };

    const [events, total] = await db.$transaction([
      db.webhookEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      db.webhookEvent.count({ where }),
    ]);

    // Resolve the candidate for each event. The event "data" lives in
    // processedPayload once handled, but for events that failed before that
    // (status FAILED/RECEIVED) it's only in rawPayload.data — fall back to it.
    //
    // Linq is inconsistent about where the identifier lives:
    //   - message.sent/delivered/read/received → data.id (message id),
    //     data.chat.id (chat id)
    //   - message.failed → data.message_id + data.chat_id (flat)
    // So we resolve by message id (id OR message_id) and fall back to chat id.
    const eventData = (e: (typeof events)[number]): Record<string, unknown> | null => {
      const processed = e.processedPayload as Record<string, unknown> | null;
      if (processed) return processed;
      const raw = e.rawPayload as Record<string, unknown> | null;
      return (raw?.data as Record<string, unknown> | null) ?? null;
    };

    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 ? v : undefined;

    const msgIdOf = (d: Record<string, unknown> | null): string | undefined =>
      d ? str(d.id) ?? str(d.message_id) : undefined;

    const chatIdOf = (d: Record<string, unknown> | null): string | undefined => {
      if (!d) return undefined;
      const chat = d.chat as Record<string, unknown> | undefined;
      return str(chat?.id) ?? str(d.chat_id);
    };

    const linqMessageIds = new Set<string>();
    const linqChatIds = new Set<string>();
    for (const e of events) {
      const d = eventData(e);
      const mid = msgIdOf(d);
      const cid = chatIdOf(d);
      if (mid) linqMessageIds.add(mid);
      if (cid) linqChatIds.add(cid);
    }

    const candidateSelect = { select: { id: true, name: true, phone: true } } as const;

    const [messages, conversations] = await Promise.all([
      linqMessageIds.size
        ? db.message.findMany({
            where: { linqMessageId: { in: [...linqMessageIds] } },
            select: {
              linqMessageId: true,
              conversation: { select: { candidate: candidateSelect } },
            },
          })
        : Promise.resolve([]),
      linqChatIds.size
        ? db.conversation.findMany({
            where: { linqChatId: { in: [...linqChatIds] } },
            select: { linqChatId: true, candidate: candidateSelect },
          })
        : Promise.resolve([]),
    ]);

    const candidateByLinqMsgId = new Map(
      messages.map((m) => [m.linqMessageId!, m.conversation.candidate])
    );
    const candidateByLinqChatId = new Map(
      conversations.map((c) => [c.linqChatId, c.candidate])
    );

    const data: WebhookEventWithCandidate[] = events.map((e) => {
      const d = eventData(e);
      const mid = msgIdOf(d);
      const cid = chatIdOf(d);
      const candidate =
        (mid ? candidateByLinqMsgId.get(mid) : undefined) ??
        (cid ? candidateByLinqChatId.get(cid) : undefined) ??
        null;
      return { ...e, candidate };
    });

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

  async countByStatus(): Promise<Record<WebhookEventStatus, number>> {
    const results = await db.webhookEvent.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    const counts = {
      RECEIVED: 0,
      PROCESSING: 0,
      PROCESSED: 0,
      FAILED: 0,
      DUPLICATE: 0,
    } as Record<WebhookEventStatus, number>;

    for (const r of results) {
      counts[r.status] = r._count.status;
    }
    return counts;
  },
};
