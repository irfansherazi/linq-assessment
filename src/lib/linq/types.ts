/**
 * Linq Partner API v3 — TypeScript types.
 *
 * Derived from the official documentation at https://docs.linqapp.com/
 * All types are documented inline with the source spec reference.
 */

// ─────────────────────────────────────────
// REQUEST TYPES
// ─────────────────────────────────────────

export type LinqMessagePartType = "text" | "media" | "link" | "app_card";
export type LinqPreferredService = "SMS" | "iMessage" | "RCS";

export interface LinqMessagePart {
  type: LinqMessagePartType;
  value: string;        // Text content for "text"; URL for "media"/"link"
  mime_type?: string;   // Required for "media"
}

export interface LinqSendMessageBody {
  /** E.164 phone number of the sending Linq number */
  from: string;
  /** E.164 phone numbers of recipients */
  to: string[];
  message: {
    parts: LinqMessagePart[];
    /** Idempotency key (max 255 chars) — safe to retry on 5xx */
    idempotency_key?: string;
    /** Force a specific protocol; omit for auto-select (iMessage > RCS > SMS) */
    preferred_service?: LinqPreferredService;
    /** Reply-to reference for threaded messages */
    reply_to?: { message_id: string; part_index?: number };
  };
}

export interface LinqReplyMessageBody {
  message: {
    parts: LinqMessagePart[];
    idempotency_key?: string;
    preferred_service?: LinqPreferredService;
    reply_to?: { message_id: string; part_index?: number };
  };
}

// ─────────────────────────────────────────
// RESPONSE TYPES
// ─────────────────────────────────────────

export type LinqMessageStatus =
  | "pending"
  | "queued"
  | "sent"
  | "delivered"
  | "received"
  | "read"
  | "failed";

export interface LinqMessageObject {
  id: string;
  chat_id: string;
  delivery_status: LinqMessageStatus;
  is_from_me: boolean;
  service: "SMS" | "iMessage" | "RCS";
  parts: LinqMessagePart[];
  created_at: string;       // ISO 8601
  updated_at: string;
  sent_at?: string;
  delivered_at?: string;    // iMessage/RCS only
  read_at?: string;         // iMessage only
}

export interface LinqChatObject {
  id: string;
  participants?: string[];
  handles?: Array<{
    id: string;
    handle: string;
    is_me: boolean;
    service: string;
    status: string;
  }>;
  display_name?: string;
  is_group?: boolean;
  service?: string;
  health_status?: {
    status: string;
    doc_url?: string;
    updated_at?: string;
  };
  created_at?: string;
  updated_at?: string;
  /** The just-sent message — nested inside chat on POST /chats response */
  message?: LinqMessageObject;
}

/** Response from POST /chats — message is nested inside chat */
export interface LinqCreateChatResponse {
  chat: LinqChatObject;
}

/** Response from POST /chats/:chatId/messages */
export interface LinqSendReplyResponse {
  message: LinqMessageObject;
}

export interface LinqPhoneNumber {
  id: string;
  phone_number: string;
  health_status: {
    status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
    doc_url?: string;
  };
}

export interface LinqPhoneNumbersResponse {
  phone_numbers: LinqPhoneNumber[];
}

/** Linq error response envelope */
export interface LinqErrorResponse {
  error?: {
    code: number | string;
    message: string;
  };
  message?: string;
  code?: number;
  retry_after?: number;  // present on 429
}

// ─────────────────────────────────────────
// WEBHOOK TYPES (Standard Webhooks spec)
// ─────────────────────────────────────────

export type LinqWebhookEventType =
  | "message.sent"
  | "message.received"
  | "message.read"
  | "message.delivered"
  | "message.failed"
  | "message.edited"
  | "reaction.added"
  | "reaction.removed"
  | "participant.added"
  | "participant.removed"
  | "chat.created"
  | "phone_number.status_updated"
  | string; // extensible

export interface LinqWebhookPayload<TData = Record<string, unknown>> {
  api_version: string;
  webhook_version: string;
  event_type: LinqWebhookEventType;
  event_id: string;      // == webhook-id header
  created_at: string;    // ISO 8601
  trace_id?: string;
  partner_id?: string;
  data: TData;
}

export interface LinqMessageEventData {
  // message.sent / message.received / message.delivered — nested shape
  chat?: {
    id: string;
    participants?: string[];
    service?: string;
  };
  id?: string;           // message ID (sent/received/delivered events)
  from?: string;         // sender handle / phone
  parts?: LinqMessagePart[];
  sent_at?: string;
  delivered_at?: string;
  failed_at?: string;
  service?: string;
  code?: number | string;
  reason?: string;
  // message.failed — flat shape
  message_id?: string;   // message ID (failed events)
  chat_id?: string;      // chat ID (failed events)
}

export interface LinqWebhookSubscriptionRequest {
  target_url: string;
  subscribed_events: LinqWebhookEventType[];
  phone_numbers?: string[];
}

export interface LinqWebhookSubscriptionResponse {
  id: string;
  target_url: string;
  subscribed_events: LinqWebhookEventType[];
  phone_numbers?: string[];
  /** Only returned at creation time — store immediately */
  signing_secret: string;
  created_at: string;
  updated_at: string;
}

export interface LinqWebhookSubscriptionsListResponse {
  webhook_subscriptions: Omit<LinqWebhookSubscriptionResponse, "signing_secret">[];
}
