/**
 * MessagingProvider interface — the abstraction layer that isolates
 * all messaging infrastructure from the business logic.
 *
 * Only one implementation exists today (LinqMessagingProvider),
 * but the interface makes swapping to Twilio, Vonage, etc. a
 * single-file change without touching any calling code.
 */
import type { MessageStatus } from "@/generated/prisma";
import type { SendMessageParams, SendMessageResult } from "@/types";

export interface MessagingProvider {
  readonly name: string;

  /**
   * Send a new message to a candidate.
   * If linqChatId is provided, sends as a reply in that chat.
   * Otherwise, opens a new Linq chat.
   */
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;

  /**
   * Retrieve the current delivery status of a message from the provider.
   * Used to poll status when webhooks aren't available.
   */
  getMessageStatus(linqMessageId: string): Promise<MessageStatus>;
}
