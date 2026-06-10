/**
 * LinqMessagingProvider — the live implementation of MessagingProvider.
 *
 * Wraps the Linq API client with:
 * - Idempotency key forwarding
 * - Status mapping from Linq status strings → MessageStatus enum
 * - Error translation from LinqApiError → MessageSendError
 * - Structured logging of every send attempt
 */
import type { MessageStatus } from "@/generated/prisma";
import type { MessagingProvider } from "./provider";
import type { SendMessageParams, SendMessageResult } from "@/types";
import { getLinqClient } from "@/lib/linq/client";
import { linqLogger } from "@/lib/logger";
import { MessageSendError } from "@/lib/errors";
import type { LinqMessageStatus } from "@/lib/linq/types";

/** Map Linq delivery status strings → internal MessageStatus enum values */
function mapLinqStatus(status: LinqMessageStatus): MessageStatus {
  const map: Record<LinqMessageStatus, MessageStatus> = {
    pending: "PENDING",
    queued: "QUEUED",
    sent: "SENT",
    delivered: "DELIVERED",
    received: "RECEIVED",
    read: "READ",
    failed: "FAILED",
  };
  return map[status] ?? "QUEUED";
}

export class LinqMessagingProvider implements MessagingProvider {
  readonly name = "Linq";

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const client = getLinqClient();
    const fromPhone =
      process.env.LINQ_FROM_PHONE;

    if (!fromPhone) {
      throw new MessageSendError(
        "LINQ_FROM_PHONE environment variable is not set"
      );
    }

    linqLogger.info({
      msg: "Sending message via Linq",
      to: params.to,
      idempotencyKey: params.idempotencyKey,
      hasExistingChat: !!params.linqChatId,
    });

    try {
      if (params.linqChatId) {
        // ── Reply in existing chat ──────────────────────────────────
        const result = await client.sendReply(params.linqChatId, {
          message: {
            parts: [{ type: "text", value: params.body }],
            idempotency_key: params.idempotencyKey,
            preferred_service: "SMS",
          },
        });

        linqLogger.info({
          msg: "Message sent via Linq (reply)",
          linqMessageId: result.message.id,
          linqChatId: params.linqChatId,
          status: result.message.delivery_status,
        });

        return {
          linqChatId: params.linqChatId,
          linqMessageId: result.message.id,
          status: mapLinqStatus(result.message.delivery_status),
        };
      } else {
        // ── Start new conversation ──────────────────────────────────
        const result = await client.createChat({
          from: fromPhone,
          to: [params.to],
          message: {
            parts: [{ type: "text", value: params.body }],
            idempotency_key: params.idempotencyKey,
            preferred_service: "SMS",
          },
        });

        // Linq nests the message inside the chat object on POST /chats
        const sentMessage = result.chat.message;
        if (!sentMessage) {
          throw new MessageSendError(
            `Linq POST /chats response missing chat.message (chat id: ${result.chat.id})`
          );
        }

        linqLogger.info({
          msg: "Message sent via Linq (new chat)",
          linqMessageId: sentMessage.id,
          linqChatId: result.chat.id,
          status: sentMessage.delivery_status,
        });

        return {
          linqChatId: result.chat.id,
          linqMessageId: sentMessage.id,
          status: mapLinqStatus(sentMessage.delivery_status),
        };
      }
    } catch (err) {
      if (err instanceof MessageSendError) throw err;

      const message =
        err instanceof Error ? err.message : "Unknown error sending message";
      throw new MessageSendError(message, err instanceof Error ? err : undefined);
    }
  }

  async getMessageStatus(linqMessageId: string): Promise<MessageStatus> {
    const client = getLinqClient();

    try {
      const message = await client.getMessage(linqMessageId);
      return mapLinqStatus(message.delivery_status);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error getting message status";
      throw new MessageSendError(
        `Failed to get status for message ${linqMessageId}: ${message}`,
        err instanceof Error ? err : undefined
      );
    }
  }
}

/** Module-level singleton */
let _provider: LinqMessagingProvider | undefined;

export function getMessagingProvider(): LinqMessagingProvider {
  if (!_provider) {
    _provider = new LinqMessagingProvider();
  }
  return _provider;
}
