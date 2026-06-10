/**
 * Webhook idempotency and dispatch unit tests.
 *
 * Tests the full webhook POST handler by mocking:
 * - webhookEventRepository (DB layer)
 * - dispatchWebhookEvent (handler dispatch)
 * - webhookRateLimiter (rate limit)
 *
 * This proves the idempotency gate, signature verification integration,
 * and the "always 200 after verify" contract — without a real database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock("@/repositories/webhook-event.repository", () => ({
  webhookEventRepository: {
    findOrCreate: vi.fn(),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/app/api/webhooks/linq/dispatch", () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ratelimit", () => ({
  webhookRateLimiter: {
    check: vi.fn().mockResolvedValue({ allowed: true, resetInMs: 0 }),
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import { POST } from "@/app/api/webhooks/linq/route";
import { webhookEventRepository } from "@/repositories/webhook-event.repository";
import { dispatchWebhookEvent } from "@/app/api/webhooks/linq/dispatch";
import { webhookRateLimiter } from "@/lib/ratelimit";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET_BYTES = Buffer.from("webhook-signing-secret-for-tests!!", "utf8");
const TEST_SECRET = `whsec_${TEST_SECRET_BYTES.toString("base64")}`;

function buildSignedRequest(
  body: object,
  overrides: {
    webhookId?: string;
    timestamp?: string;
    secret?: string;
    tamperBody?: boolean;
  } = {}
): NextRequest {
  const rawBody = JSON.stringify(body);
  const webhookId = overrides.webhookId ?? `wh-test-${Date.now()}`;
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const secret = overrides.secret ?? TEST_SECRET;

  const secretBase64 = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  const secretBytes = Buffer.from(secretBase64, "base64");
  const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
  const sig = createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest("base64");

  const bodyToSend = overrides.tamperBody ? rawBody + " tampered" : rawBody;

  return new NextRequest("http://localhost/api/webhooks/linq", {
    method: "POST",
    body: bodyToSend,
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${sig}`,
    },
  });
}

const SAMPLE_PAYLOAD = {
  event_id: "evt_test_12345",
  event_type: "message.sent",
  trace_id: "trace_abc",
  data: {
    id: "msg_linq_xyz",
    status: "sent",
    sent_at: "2025-01-01T00:00:00Z",
  },
};

const NEW_EVENT = {
  id: "db-event-id-1",
  linqEventId: "evt_test_12345",
  eventType: "message.sent",
  status: "PENDING",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/linq", () => {
  beforeEach(() => {
    process.env.LINQ_WEBHOOK_SECRET = TEST_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("signature verification", () => {
    it("accepts a correctly signed request", async () => {
      vi.mocked(webhookEventRepository.findOrCreate).mockResolvedValue({
        event: NEW_EVENT as never,
        created: true,
      });

      const req = buildSignedRequest(SAMPLE_PAYLOAD);
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it("rejects a tampered body with 401", async () => {
      const req = buildSignedRequest(SAMPLE_PAYLOAD, { tamperBody: true });
      const res = await POST(req);

      expect(res.status).toBe(401);
      // Dispatch should never be called
      expect(dispatchWebhookEvent).not.toHaveBeenCalled();
    });

    it("rejects when signature headers are missing with 401", async () => {
      const req = new NextRequest("http://localhost/api/webhooks/linq", {
        method: "POST",
        body: JSON.stringify(SAMPLE_PAYLOAD),
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects an expired timestamp with 401", async () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 6.5 min ago
      const req = buildSignedRequest(SAMPLE_PAYLOAD, {
        timestamp: oldTimestamp,
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  describe("idempotency gate", () => {
    it("processes a new event and calls dispatch", async () => {
      vi.mocked(webhookEventRepository.findOrCreate).mockResolvedValue({
        event: NEW_EVENT as never,
        created: true,
      });

      const req = buildSignedRequest(SAMPLE_PAYLOAD);
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.duplicate).toBeUndefined();
      expect(dispatchWebhookEvent).toHaveBeenCalledOnce();
      expect(webhookEventRepository.markProcessing).toHaveBeenCalledWith(
        NEW_EVENT.id
      );
    });

    it("returns 200 for duplicate event WITHOUT calling dispatch", async () => {
      vi.mocked(webhookEventRepository.findOrCreate).mockResolvedValue({
        event: { ...NEW_EVENT, status: "PROCESSED" } as never,
        created: false, // already seen
      });

      const req = buildSignedRequest(SAMPLE_PAYLOAD);
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.duplicate).toBe(true);
      expect(dispatchWebhookEvent).not.toHaveBeenCalled();
      expect(webhookEventRepository.markProcessing).not.toHaveBeenCalled();
    });

    it("marks event PROCESSED after successful dispatch", async () => {
      vi.mocked(webhookEventRepository.findOrCreate).mockResolvedValue({
        event: NEW_EVENT as never,
        created: true,
      });

      const req = buildSignedRequest(SAMPLE_PAYLOAD);
      await POST(req);

      expect(webhookEventRepository.markProcessed).toHaveBeenCalledWith(
        NEW_EVENT.id,
        SAMPLE_PAYLOAD.data
      );
      expect(webhookEventRepository.markFailed).not.toHaveBeenCalled();
    });

    it("marks event FAILED and still returns 200 when dispatch throws", async () => {
      vi.mocked(webhookEventRepository.findOrCreate).mockResolvedValue({
        event: NEW_EVENT as never,
        created: true,
      });

      const dispatchError = new Error("Downstream DB failure");
      vi.mocked(dispatchWebhookEvent).mockRejectedValueOnce(dispatchError);

      const req = buildSignedRequest(SAMPLE_PAYLOAD);
      const res = await POST(req);
      const body = await res.json();

      // ALWAYS 200 after verification — prevent retry storms
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.error).toContain("Downstream DB failure");
      expect(webhookEventRepository.markFailed).toHaveBeenCalledWith(
        NEW_EVENT.id,
        "Downstream DB failure"
      );
    });
  });

  describe("rate limiting", () => {
    it("returns 429 when rate limit exceeded", async () => {
      vi.mocked(webhookRateLimiter.check).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetInMs: 5000,
      });

      const req = buildSignedRequest(SAMPLE_PAYLOAD);
      const res = await POST(req);

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("5");
      expect(dispatchWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe("payload validation", () => {
    it("returns 400 for invalid JSON", async () => {
      // We need to craft a request with valid signature over invalid JSON
      const invalidBody = "not valid json {{{{";
      const webhookId = "wh-bad-json";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const secretBase64 = TEST_SECRET.slice("whsec_".length);
      const secretBytes = Buffer.from(secretBase64, "base64");
      const sig = createHmac("sha256", secretBytes)
        .update(`${webhookId}.${timestamp}.${invalidBody}`, "utf8")
        .digest("base64");

      const req = new NextRequest("http://localhost/api/webhooks/linq", {
        method: "POST",
        body: invalidBody,
        headers: {
          "content-type": "application/json",
          "webhook-id": webhookId,
          "webhook-timestamp": timestamp,
          "webhook-signature": `v1,${sig}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for payload missing event_id", async () => {
      const badPayload = { event_type: "message.sent", data: {} };
      // Sign it properly but omit event_id
      const webhookId = "wh-no-event-id";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const rawBody = JSON.stringify(badPayload);
      const secretBase64 = TEST_SECRET.slice("whsec_".length);
      const secretBytes = Buffer.from(secretBase64, "base64");
      const sig = createHmac("sha256", secretBytes)
        .update(`${webhookId}.${timestamp}.${rawBody}`, "utf8")
        .digest("base64");

      const req = new NextRequest("http://localhost/api/webhooks/linq", {
        method: "POST",
        body: rawBody,
        headers: {
          "content-type": "application/json",
          "webhook-id": webhookId,
          "webhook-timestamp": timestamp,
          "webhook-signature": `v1,${sig}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
