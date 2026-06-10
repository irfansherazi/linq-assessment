/**
 * Shared domain types for CandidateFlow.
 * These are the canonical application-layer types — not tied to Prisma models
 * or wire formats. Use these in services, repositories, and API responses.
 */
export type {
  User,
  Candidate,
  Screening,
  ScreeningQuestion,
  ScreeningResponse,
  Conversation,
  Message,
  MessageEvent,
  WebhookEvent,
  RetryJob,
  AuditLog,
  PasswordResetToken,
} from "@/generated/prisma";

export type {
  UserRole,
  CandidateStatus,
  ScreeningState,
  MessageDirection,
  MessageStatus,
  WebhookEventStatus,
  RetryJobStatus,
  AuditAction,
} from "@/generated/prisma";

// ─────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// ─────────────────────────────────────────
// Candidate
// ─────────────────────────────────────────

export interface CreateCandidateInput {
  recruiterId: string;
  name: string;
  phone: string; // E.164
  role: string;
  notes?: string;
}

export interface UpdateCandidateInput {
  name?: string;
  role?: string;
  notes?: string;
}

export interface CandidateWithScreening {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: import("@/generated/prisma").CandidateStatus;
  createdAt: Date;
  updatedAt: Date;
  activeScreening?: {
    id: string;
    state: import("@/generated/prisma").ScreeningState;
    currentQuestionIndex: number;
    startedAt: Date | null;
  } | null;
}

// ─────────────────────────────────────────
// Linq API types
// ─────────────────────────────────────────

export interface LinqMessagePart {
  type: "text" | "media";
  value: string;
}

export interface LinqSendMessageParams {
  from: string;
  to: string[];
  parts: LinqMessagePart[];
  idempotencyKey?: string;
  preferredService?: "SMS" | "iMessage" | "RCS";
}

export interface LinqSendResult {
  chatId: string;
  messageId: string;
  status: string;
}

export interface LinqWebhookEvent {
  api_version: string;
  webhook_version: string;
  event_type: string;
  event_id: string;
  created_at: string;
  trace_id?: string;
  partner_id?: string;
  data: Record<string, unknown>;
}

// ─────────────────────────────────────────
// Messaging abstraction
// ─────────────────────────────────────────

export interface SendMessageParams {
  conversationId?: string;   // Set if conversation already exists
  linqChatId?: string;       // Set if continuing existing Linq chat
  to: string;                // E.164 phone number
  from: string;              // E.164 phone number
  body: string;
  idempotencyKey: string;
}

export interface SendMessageResult {
  linqChatId: string;
  linqMessageId: string;
  status: import("@/generated/prisma").MessageStatus;
}

// ─────────────────────────────────────────
// Screening workflow
// ─────────────────────────────────────────

export type ScreeningStateValue = import("@/generated/prisma").ScreeningState;

export interface StateTransition {
  from: ScreeningStateValue;
  to: ScreeningStateValue;
  trigger: string; // human-readable description
}

// ─────────────────────────────────────────
// Webhook dispatch
// ─────────────────────────────────────────

export interface WebhookDispatchContext {
  eventId: string;
  eventType: string;
  traceId?: string;
  data: Record<string, unknown>;
  rawPayload: string;
}
