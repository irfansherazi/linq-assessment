/**
 * Linq webhook ingestion endpoint.
 *
 * Processing pipeline (in strict order):
 * 1. Read raw body (must be raw, not parsed, for signature verification)
 * 2. Verify Standard Webhooks signature (HMAC-SHA256)
 * 3. Parse body as JSON
 * 4. Rate limit check
 * 5. Idempotency gate: findOrCreate WebhookEvent by linqEventId
 *    - If duplicate → log + return 200 (idempotent)
 * 6. Mark event as PROCESSING
 * 7. Dispatch to type-specific handler
 * 8. Mark event PROCESSED or FAILED
 *
 * Principle: ALWAYS return 200 after signature verification.
 * Returning 4xx/5xx causes Linq to retry, which we handle internally.
 * Handler failures are logged and the event is marked FAILED (for observability),
 * but we return 200 to prevent infinite retry storms.
 */
import type { NextRequest } from "next/server";
import { webhookEventRepository } from "@/repositories/webhook-event.repository";
import {
  verifyWebhookSignature,
  extractWebhookHeaders,
} from "@/lib/webhooks/verify";
import { webhookLogger } from "@/lib/logger";
import { webhookRateLimiter } from "@/lib/ratelimit";
import { WebhookVerificationError } from "@/lib/errors";
import { dispatchWebhookEvent } from "./dispatch";
import type { LinqWebhookPayload } from "@/lib/linq/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const log = webhookLogger.child({
    path: "/api/webhooks/linq",
    ip,
    requestId: request.headers.get("x-request-id") ?? "no-id",
  });

  // ── Rate limit ───────────────────────────────────────────────────
  const rateLimitResult = await webhookRateLimiter.check(ip);
  if (!rateLimitResult.allowed) {
    log.warn({ msg: "Webhook rate limit exceeded", ip });
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimitResult.resetInMs / 1000)),
        },
      }
    );
  }

  // ── Read raw body ────────────────────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    log.error({ msg: "Failed to read webhook body" });
    return Response.json({ error: "Failed to read body" }, { status: 400 });
  }

  // ── Verify signature ─────────────────────────────────────────────
  const webhookSecret = process.env.LINQ_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log.error({ msg: "LINQ_WEBHOOK_SECRET is not configured" });
    // Don't reject — we can't verify. Log and continue in dev; reject in prod.
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }
  }

  if (webhookSecret) {
    const headers = extractWebhookHeaders(request.headers);
    if (!headers) {
      log.warn({ msg: "Missing webhook signature headers" });
      return Response.json(
        { error: "Missing webhook headers" },
        { status: 401 }
      );
    }

    try {
      verifyWebhookSignature(headers, rawBody, webhookSecret);
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        log.warn({ msg: "Webhook signature verification failed", error: err.message });
        return Response.json(
          { error: "Invalid signature" },
          { status: 401 }
        );
      }
      throw err;
    }
  }

  // ── Parse body ───────────────────────────────────────────────────
  let payload: LinqWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinqWebhookPayload;
  } catch {
    log.warn({ msg: "Invalid JSON webhook body" });
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event_id: linqEventId, event_type: eventType } = payload;

  if (!linqEventId || !eventType) {
    log.warn({ msg: "Webhook payload missing event_id or event_type", payload });
    return Response.json(
      { error: "Missing event_id or event_type" },
      { status: 400 }
    );
  }

  log.info({ msg: "Webhook received", eventType, linqEventId });

  // ── Idempotency gate ─────────────────────────────────────────────
  const { event, created } = await webhookEventRepository.findOrCreate(
    linqEventId,
    eventType,
    JSON.parse(rawBody)
  );

  if (!created) {
    log.info({
      msg: "Duplicate webhook event — skipping",
      linqEventId,
      eventType,
      existingStatus: event.status,
    });
    // Return 200 — Linq doesn't need to know it was a duplicate
    return Response.json({ ok: true, duplicate: true });
  }

  // ── Dispatch to handler ──────────────────────────────────────────
  try {
    await webhookEventRepository.markProcessing(event.id);

    await dispatchWebhookEvent({
      eventId: linqEventId,
      eventType,
      traceId: payload.trace_id,
      data: payload.data,
      rawPayload: rawBody,
    });

    await webhookEventRepository.markProcessed(event.id, payload.data as unknown as import("@/generated/prisma").Prisma.InputJsonValue);

    log.info({ msg: "Webhook processed successfully", eventType, linqEventId });
    return Response.json({ ok: true });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    log.error({
      msg: "Webhook handler failed",
      eventType,
      linqEventId,
      error: errorMessage,
    });

    // Mark failed but return 200 — Linq shouldn't retry
    await webhookEventRepository
      .markFailed(event.id, errorMessage)
      .catch(() => { /* best-effort */ });

    return Response.json({ ok: true, error: errorMessage });
  }
}
