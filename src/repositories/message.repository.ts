/**
 * Message repository — all Prisma queries for Conversation, Message,
 * and MessageEvent aggregates.
 */
import { Prisma } from "@/generated/prisma";
import type {
  Message,
  MessageStatus,
  Conversation,
  MessageEvent,
} from "@/generated/prisma";
import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams } from "@/types";

export const messageRepository = {
  // ── Conversations ────────────────────────────────────────────────────

  async findConversationByCandidateId(
    candidateId: string
  ): Promise<Conversation | null> {
    return db.conversation.findUnique({ where: { candidateId } });
  },

  async findConversationByLinqChatId(
    linqChatId: string
  ): Promise<Conversation | null> {
    return db.conversation.findUnique({ where: { linqChatId } });
  },

  async createConversation(
    data: Prisma.ConversationCreateInput
  ): Promise<Conversation> {
    return db.conversation.create({ data });
  },

  // ── Messages ─────────────────────────────────────────────────────────

  async findById(id: string) {
    return db.message.findUnique({
      where: { id },
      include: { conversation: { select: { candidateId: true } } },
    });
  },

  async findByLinqMessageId(linqMessageId: string) {
    return db.message.findUnique({
      where: { linqMessageId },
      include: { conversation: { select: { candidateId: true } } },
    });
  },

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<Message | null> {
    return db.message.findUnique({ where: { idempotencyKey } });
  },

  async findByConversationId(
    conversationId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<Message>> {
    const { page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const [data, total] = await db.$transaction([
      db.message.findMany({
        where: { conversationId },
        skip,
        take: limit,
        orderBy: { createdAt: "asc" },
        include: { events: { orderBy: { createdAt: "asc" } } },
      }),
      db.message.count({ where: { conversationId } }),
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

  async findAll(
    params: PaginationParams & {
      status?: MessageStatus;
      search?: string;
      recruiterId?: string;
    } = {}
  ): Promise<PaginatedResult<Message & { conversation: Conversation }>> {
    const { page = 1, limit = 50, status, search, recruiterId } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.MessageWhereInput = {
      ...(recruiterId ? { conversation: { candidate: { recruiterId } } } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { body: { contains: search, mode: "insensitive" } },
              { linqMessageId: { contains: search } },
            ],
          }
        : {}),
    };

    const [data, total] = await db.$transaction([
      db.message.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          conversation: {
            include: {
              candidate: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      }),
      db.message.count({ where }),
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

  async createMessage(
    data: Prisma.MessageCreateInput
  ): Promise<Message> {
    return db.message.create({ data });
  },

  async updateStatus(
    id: string,
    status: MessageStatus,
    // Nullable fields accept `null` so a successful (re)send can clear the
    // error fields left over from a prior delivery failure.
    extras?: Partial<{
      linqMessageId: string | null;
      errorCode: string | null;
      errorReason: string | null;
      sentAt: Date | null;
      deliveredAt: Date | null;
      readAt: Date | null;
      failedAt: Date | null;
    }>
  ): Promise<Message> {
    return db.message.update({
      where: { id },
      data: { status, ...extras },
    });
  },

  async updateByLinqMessageId(
    linqMessageId: string,
    data: Prisma.MessageUpdateInput
  ): Promise<Message | null> {
    const existing = await db.message.findUnique({ where: { linqMessageId } });
    if (!existing) return null;
    return db.message.update({ where: { linqMessageId }, data });
  },

  // ── Message Events ───────────────────────────────────────────────────

  async createEvent(
    data: Prisma.MessageEventCreateInput
  ): Promise<MessageEvent> {
    return db.messageEvent.create({ data });
  },

  async countFailedMessages(recruiterId: string): Promise<number> {
    return db.message.count({
      where: {
        status: "FAILED",
        conversation: { candidate: { recruiterId } },
      },
    });
  },
};
