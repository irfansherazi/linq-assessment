/**
 * Linq Partner API v3 HTTP client.
 *
 * This is the ONLY place in the codebase where Linq API calls happen.
 * All methods return typed results or throw typed errors.
 *
 * Error mapping:
 * - 429 → LinqRateLimitError (with retryAfterSeconds)
 * - 401/403 → LinqApiError
 * - 4xx/5xx → LinqApiError
 * - Network errors → LinqApiError
 *
 * Retry is NOT done here — the retry system handles it at the service layer.
 */
import { linqLogger } from "@/lib/logger";
import {
  LinqApiError,
  LinqRateLimitError,
} from "@/lib/errors";
import type {
  LinqSendMessageBody,
  LinqReplyMessageBody,
  LinqCreateChatResponse,
  LinqSendReplyResponse,
  LinqMessageObject,
  LinqPhoneNumbersResponse,
  LinqErrorResponse,
  LinqWebhookSubscriptionRequest,
  LinqWebhookSubscriptionResponse,
  LinqWebhookSubscriptionsListResponse,
} from "./types";

const DEFAULT_BASE_URL = "https://api.linqapp.com/api/partner/v3";

interface LinqClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export class LinqClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: LinqClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  // ─────────────────────────────────────────
  // MESSAGES
  // ─────────────────────────────────────────

  /**
   * Start a new conversation and send the first message.
   * Use this when no Linq chat exists for the candidate yet.
   */
  async createChat(body: LinqSendMessageBody): Promise<LinqCreateChatResponse> {
    return this.post<LinqCreateChatResponse>("/chats", body);
  }

  /**
   * Send a message in an existing conversation.
   * Use this when a Linq chatId already exists for the candidate.
   */
  async sendReply(
    chatId: string,
    body: LinqReplyMessageBody
  ): Promise<LinqSendReplyResponse> {
    return this.post<LinqSendReplyResponse>(`/chats/${chatId}/messages`, body);
  }

  /**
   * Get a single message by ID.
   */
  async getMessage(messageId: string): Promise<LinqMessageObject> {
    return this.get<LinqMessageObject>(`/messages/${messageId}`);
  }

  // ─────────────────────────────────────────
  // PHONE NUMBERS
  // ─────────────────────────────────────────

  async getPhoneNumbers(): Promise<LinqPhoneNumbersResponse> {
    return this.get<LinqPhoneNumbersResponse>("/phone_numbers");
  }

  // ─────────────────────────────────────────
  // WEBHOOK SUBSCRIPTIONS
  // ─────────────────────────────────────────

  async createWebhookSubscription(
    body: LinqWebhookSubscriptionRequest
  ): Promise<LinqWebhookSubscriptionResponse> {
    return this.post<LinqWebhookSubscriptionResponse>(
      "/webhook-subscriptions",
      body
    );
  }

  async listWebhookSubscriptions(): Promise<LinqWebhookSubscriptionsListResponse> {
    return this.get<LinqWebhookSubscriptionsListResponse>("/webhook-subscriptions");
  }

  async deleteWebhookSubscription(id: string): Promise<void> {
    await this.delete(`/webhook-subscriptions/${id}`);
  }

  // ─────────────────────────────────────────
  // HTTP INTERNALS
  // ─────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const startMs = Date.now();

    linqLogger.debug({ msg: "Linq API request", method, path });

    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      const err = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      linqLogger.error({
        msg: "Linq API network error",
        method,
        path,
        error: err.message,
      });
      throw new LinqApiError({
        message: `Network error calling ${method} ${path}: ${err.message}`,
        cause: err,
      });
    }

    const durationMs = Date.now() - startMs;

    linqLogger.debug({
      msg: "Linq API response",
      method,
      path,
      status: response.status,
      durationMs,
    });

    // ── Rate limit ────────────────────────────────────────────────────
    if (response.status === 429) {
      let retryAfter = 60; // conservative default
      const retryAfterHeader = response.headers.get("Retry-After");
      if (retryAfterHeader) {
        retryAfter = parseInt(retryAfterHeader, 10) || 60;
      }

      let body: LinqErrorResponse = {};
      try {
        body = await response.json() as LinqErrorResponse;
        if (body.retry_after) retryAfter = body.retry_after;
      } catch { /* non-JSON body */ }

      linqLogger.warn({
        msg: "Linq API rate limited",
        path,
        retryAfterSeconds: retryAfter,
      });

      throw new LinqRateLimitError(retryAfter, body);
    }

    // ── Non-OK responses ──────────────────────────────────────────────
    if (!response.ok) {
      let errorBody: LinqErrorResponse = {};
      try {
        errorBody = await response.json() as LinqErrorResponse;
      } catch { /* non-JSON body */ }

      const message =
        errorBody.error?.message ??
        errorBody.message ??
        `Linq API returned ${response.status}`;

      const linqErrorCode = errorBody.error?.code ?? errorBody.code;

      linqLogger.error({
        msg: "Linq API error",
        method,
        path,
        status: response.status,
        linqErrorCode,
        linqMessage: message,
      });

      throw new LinqApiError({
        message,
        statusCode: response.status,
        responseBody: errorBody,
        linqErrorCode,
      });
    }

    // ── Success ───────────────────────────────────────────────────────
    if (response.status === 204 || method === "DELETE") {
      return undefined as T;
    }

    try {
      const responseBody = await response.json();
      linqLogger.info({
        msg: "Linq API success response",
        method,
        path,
        status: response.status,
        responseBody: JSON.stringify(responseBody),
      });
      return responseBody as T;
    } catch (parseErr) {
      throw new LinqApiError({
        message: `Failed to parse Linq API response from ${method} ${path}`,
        statusCode: response.status,
        cause: parseErr instanceof Error ? parseErr : undefined,
      });
    }
  }
}

/**
 * Module-level singleton — initialized lazily.
 * Services import `getLinqClient()` rather than creating their own instance.
 */
let _linqClient: LinqClient | undefined;

export function getLinqClient(): LinqClient {
  if (!_linqClient) {
    const apiKey = process.env.LINQ_API_KEY;
    const baseUrl = process.env.LINQ_API_BASE_URL;
    if (!apiKey) {
      throw new Error("[linq] LINQ_API_KEY is not set");
    }
    _linqClient = new LinqClient({ apiKey, baseUrl });
  }
  return _linqClient;
}

/** Reset the singleton (for testing). */
export function _resetLinqClient(): void {
  _linqClient = undefined;
}
