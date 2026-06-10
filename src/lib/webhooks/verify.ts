/**
 * Standard Webhooks signature verification for Linq webhooks.
 *
 * Spec: https://www.standardwebhooks.com/
 *
 * Algorithm:
 * 1. Decode the base64 secret (after stripping the "whsec_" prefix)
 * 2. Build the signed content string: "{webhook-id}.{webhook-timestamp}.{body}"
 * 3. Compute HMAC-SHA256 of the signed content using the decoded secret key
 * 4. Base64-encode the HMAC digest
 * 5. Compare against each value in the comma-separated webhook-signature header
 *    using a timing-safe comparison to prevent timing attacks
 *
 * Timestamp tolerance: ±5 minutes (300 seconds) to handle clock skew.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { WebhookVerificationError } from "@/lib/errors";
import { webhookLogger } from "@/lib/logger";

const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

export interface WebhookHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
}

/**
 * Verify a Linq webhook request.
 *
 * @param headers - The three Standard Webhooks headers
 * @param rawBody - The raw request body string (before any JSON.parse)
 * @param secret - The webhook signing secret (with or without "whsec_" prefix)
 * @throws WebhookVerificationError if verification fails
 */
export function verifyWebhookSignature(
  headers: WebhookHeaders,
  rawBody: string,
  secret: string
): void {
  const { "webhook-id": webhookId, "webhook-timestamp": webhookTimestamp, "webhook-signature": webhookSignature } = headers;

  // ── Validate header presence ──────────────────────────────────────
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    webhookLogger.warn({ msg: "Missing Standard Webhooks headers" });
    throw new WebhookVerificationError(
      "Missing required webhook headers: webhook-id, webhook-timestamp, webhook-signature"
    );
  }

  // ── Validate timestamp to prevent replay attacks ──────────────────
  const timestampSeconds = parseInt(webhookTimestamp, 10);
  if (isNaN(timestampSeconds)) {
    throw new WebhookVerificationError(
      `Invalid webhook-timestamp: "${webhookTimestamp}"`
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.abs(nowSeconds - timestampSeconds);

  if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
    webhookLogger.warn({
      msg: "Webhook timestamp too old or too far in the future",
      ageSeconds,
      toleranceSeconds: TIMESTAMP_TOLERANCE_SECONDS,
    });
    throw new WebhookVerificationError(
      `Webhook timestamp is ${ageSeconds}s away from current time (tolerance: ${TIMESTAMP_TOLERANCE_SECONDS}s)`
    );
  }

  // ── Decode signing secret ─────────────────────────────────────────
  const secretBase64 = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;

  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretBase64, "base64");
  } catch {
    throw new WebhookVerificationError("Invalid webhook signing secret format");
  }

  // ── Compute expected signature ────────────────────────────────────
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expectedDigest = createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest("base64");

  // ── Compare against all signatures in the header ──────────────────
  // Header may contain multiple space-separated "v1,<base64>" values
  const signatures = webhookSignature
    .split(" ")
    .map((s) => {
      // Format: "v1,<base64>" or just "<base64>"
      const parts = s.split(",");
      return parts.length > 1 ? parts.slice(1).join(",") : parts[0];
    })
    .filter(Boolean);

  if (signatures.length === 0) {
    throw new WebhookVerificationError("No signatures found in webhook-signature header");
  }

  const expectedBuffer = Buffer.from(expectedDigest, "utf8");
  const isValid = signatures.some((sig) => {
    try {
      const sigBuffer = Buffer.from(sig, "utf8");
      // Buffers must be equal length for timingSafeEqual
      if (sigBuffer.length !== expectedBuffer.length) {
        // Use a constant-time comparison with padding to avoid length leakage
        const padded = Buffer.alloc(expectedBuffer.length, 0);
        sig.slice(0, expectedBuffer.length).split("").forEach((c, i) => {
          padded[i] = c.charCodeAt(0);
        });
        timingSafeEqual(padded, expectedBuffer); // will return false
        return false;
      }
      return timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  });

  if (!isValid) {
    webhookLogger.warn({
      msg: "Webhook signature verification failed",
      webhookId,
      signaturesChecked: signatures.length,
    });
    throw new WebhookVerificationError("Webhook signature does not match");
  }

  webhookLogger.debug({
    msg: "Webhook signature verified",
    webhookId,
    timestampAge: ageSeconds,
  });
}

/**
 * Extract webhook headers from a NextRequest, returning null if any are missing.
 * This helper makes it easy to call verifyWebhookSignature from a route handler.
 */
export function extractWebhookHeaders(
  headers: Headers
): WebhookHeaders | null {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return null;
  }

  return {
    "webhook-id": webhookId,
    "webhook-timestamp": webhookTimestamp,
    "webhook-signature": webhookSignature,
  };
}
