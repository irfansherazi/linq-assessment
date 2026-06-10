/**
 * Webhook signature verification unit tests.
 *
 * Tests cover:
 * - Valid signature passes
 * - Tampered body fails
 * - Invalid secret fails
 * - Expired timestamp fails
 * - Missing headers fail
 * - Multiple signatures in header (v1,<sig> format)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  verifyWebhookSignature,
  extractWebhookHeaders,
  type WebhookHeaders,
} from "@/lib/webhooks/verify";
import { WebhookVerificationError } from "@/lib/errors";

// Test secret (whsec_ prefix + base64)
const TEST_SECRET_BYTES = Buffer.from("test-secret-for-unit-testing-12345", "utf-8");
const TEST_SECRET = `whsec_${TEST_SECRET_BYTES.toString("base64")}`;

function buildSignature(
  webhookId: string,
  timestamp: string,
  body: string,
  secret = TEST_SECRET
): string {
  const secretBase64 = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  const secretBytes = Buffer.from(secretBase64, "base64");
  const signedContent = `${webhookId}.${timestamp}.${body}`;
  const digest = createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest("base64");
  return `v1,${digest}`;
}

describe("verifyWebhookSignature", () => {
  const body = '{"event_type":"message.sent","event_id":"test-id"}';
  const webhookId = "wh-test-12345";
  let nowSeconds: string;

  beforeEach(() => {
    nowSeconds = String(Math.floor(Date.now() / 1000));
  });

  it("accepts a valid signature", () => {
    const sig = buildSignature(webhookId, nowSeconds, body);
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": nowSeconds,
      "webhook-signature": sig,
    };

    expect(() =>
      verifyWebhookSignature(headers, body, TEST_SECRET)
    ).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const sig = buildSignature(webhookId, nowSeconds, body);
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": nowSeconds,
      "webhook-signature": sig,
    };

    const tamperedBody = body + " extra";
    expect(() =>
      verifyWebhookSignature(headers, tamperedBody, TEST_SECRET)
    ).toThrow(WebhookVerificationError);
  });

  it("rejects a wrong secret", () => {
    const sig = buildSignature(webhookId, nowSeconds, body);
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": nowSeconds,
      "webhook-signature": sig,
    };

    const wrongSecret = `whsec_${Buffer.from("wrong-secret-bytes!!!!!!!!!!!!!").toString("base64")}`;
    expect(() =>
      verifyWebhookSignature(headers, body, wrongSecret)
    ).toThrow(WebhookVerificationError);
  });

  it("rejects an expired timestamp (>5 minutes old)", () => {
    const oldTimestamp = String(
      Math.floor(Date.now() / 1000) - 400 // 6min 40s ago
    );
    const sig = buildSignature(webhookId, oldTimestamp, body);
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": oldTimestamp,
      "webhook-signature": sig,
    };

    expect(() =>
      verifyWebhookSignature(headers, body, TEST_SECRET)
    ).toThrow(WebhookVerificationError);
  });

  it("rejects a future timestamp beyond tolerance", () => {
    const futureTimestamp = String(
      Math.floor(Date.now() / 1000) + 400
    );
    const sig = buildSignature(webhookId, futureTimestamp, body);
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": futureTimestamp,
      "webhook-signature": sig,
    };

    expect(() =>
      verifyWebhookSignature(headers, body, TEST_SECRET)
    ).toThrow(WebhookVerificationError);
  });

  it("rejects invalid (non-numeric) timestamp", () => {
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": "not-a-number",
      "webhook-signature": "v1,fakesig",
    };

    expect(() =>
      verifyWebhookSignature(headers, body, TEST_SECRET)
    ).toThrow(WebhookVerificationError);
  });

  it("accepts signature without whsec_ prefix", () => {
    const rawSecret = TEST_SECRET.slice("whsec_".length);
    const sig = buildSignature(webhookId, nowSeconds, body, rawSecret);
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": nowSeconds,
      "webhook-signature": sig,
    };

    // Should work with raw base64 secret too
    expect(() =>
      verifyWebhookSignature(headers, body, rawSecret)
    ).not.toThrow();
  });

  it("accepts when one of multiple signatures matches", () => {
    const validSig = buildSignature(webhookId, nowSeconds, body);
    const invalidSig = "v1,invalidsignaturexxx";
    const headers: WebhookHeaders = {
      "webhook-id": webhookId,
      "webhook-timestamp": nowSeconds,
      // Space-separated multiple signatures
      "webhook-signature": `${invalidSig} ${validSig}`,
    };

    expect(() =>
      verifyWebhookSignature(headers, body, TEST_SECRET)
    ).not.toThrow();
  });
});

describe("extractWebhookHeaders", () => {
  it("returns headers when all three are present", () => {
    const headers = new Headers({
      "webhook-id": "wh-123",
      "webhook-timestamp": "1234567890",
      "webhook-signature": "v1,abc123",
    });
    const result = extractWebhookHeaders(headers);
    expect(result).not.toBeNull();
    expect(result!["webhook-id"]).toBe("wh-123");
  });

  it("returns null when any header is missing", () => {
    const partial = new Headers({
      "webhook-id": "wh-123",
      // missing timestamp and signature
    });
    expect(extractWebhookHeaders(partial)).toBeNull();
  });

  it("returns null for empty headers", () => {
    expect(extractWebhookHeaders(new Headers())).toBeNull();
  });
});
