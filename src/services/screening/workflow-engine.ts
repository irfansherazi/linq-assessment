/**
 * Screening workflow engine — orchestrates the candidate SMS Q&A flow.
 *
 * This service owns:
 * - Starting a screening (sending the intro message)
 * - Processing inbound replies (advancing state, sending next question)
 * - Failing a screening on delivery failure
 *
 * Every operation runs in a single DB transaction to guarantee consistency:
 * if the SMS send fails, the DB state is not advanced.
 *
 * The engine depends on:
 * - screeningRepository: state persistence
 * - messageRepository: message lifecycle
 * - candidateRepository: status updates
 * - LinqMessagingProvider: outbound SMS
 * - audit service: trail writing
 */
import { db } from "@/lib/db";
import { nanoid } from "nanoid";
import { screeningRepository } from "@/repositories/screening.repository";
import { messageRepository } from "@/repositories/message.repository";
import { getMessagingProvider } from "@/services/messaging/linq-provider";
import { audit } from "@/services/audit";
import { screeningLogger } from "@/lib/logger";
import {
  BusinessLogicError,
  NotFoundError,
} from "@/lib/errors";
import {
  computeNextState,
  shouldProcessReply,
  stateToQuestionIndex,
  isQuestionState,
} from "./state-machine";
import type { Screening, ScreeningQuestion, ScreeningState } from "@/generated/prisma";

// ── Message templates ────────────────────────────────────────────────────────

function buildIntroMessage(candidateName: string, role: string): string {
  const firstName = candidateName.split(" ")[0];
  return (
    `Hi ${firstName}, thanks for applying for the ${role} role. ` +
    `We'd like to ask you a few quick screening questions. ` +
    `Reply START to begin.`
  );
}

function buildQuestionMessage(
  question: ScreeningQuestion,
  index: number,
  total: number
): string {
  return `Question ${index + 1} of ${total}: ${question.prompt}`;
}

function buildCompletionMessage(candidateName: string): string {
  const firstName = candidateName.split(" ")[0];
  return (
    `Thank you, ${firstName}! We've received all your answers. ` +
    `Our team will review your responses and be in touch soon.`
  );
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface StartScreeningResult {
  screeningId: string;
  messageId: string;
  linqChatId: string;
}

export interface ProcessReplyResult {
  consumed: boolean; // false if message was ignored (e.g. non-START in STARTED state)
  nextState: ScreeningState;
  messageId?: string;
}

const messagingProvider = getMessagingProvider();

export const workflowEngine = {
  /**
   * Launch a screening for a candidate.
   *
   * 1. Create/update the Screening record (PENDING → STARTED conceptually:
   *    we set state to STARTED when the intro is sent successfully)
   * 2. Send the intro SMS
   * 3. Persist conversation + message records
   * 4. Write audit log
   */
  async startScreening(
    screeningId: string,
    actorId?: string
  ): Promise<StartScreeningResult> {
    const screening = await screeningRepository.findByIdWithResponses(screeningId);
    if (!screening) {
      throw new NotFoundError("Screening", screeningId);
    }

    const candidate = screening.candidate;

    if (screening.state !== "PENDING") {
      throw new BusinessLogicError(
        `Screening ${screeningId} cannot be started from state "${screening.state}"`,
        "SCREENING_ALREADY_STARTED"
      );
    }

    const fromPhone = process.env.LINQ_FROM_PHONE!;
    const introMessage = buildIntroMessage(candidate.name, candidate.role);
    const idempotencyKey = `screening-intro-${screeningId}-${nanoid(8)}`;

    screeningLogger.info({
      msg: "Starting screening",
      screeningId,
      candidateId: candidate.id,
      candidateName: candidate.name,
    });

    // ── Ensure conversation exists ──────────────────────────────────
    let conversation = await messageRepository.findConversationByCandidateId(
      candidate.id
    );

    // ── Send intro SMS ──────────────────────────────────────────────
    const sendResult = await messagingProvider.sendMessage({
      linqChatId: conversation?.linqChatId,
      to: candidate.phone,
      from: fromPhone,
      body: introMessage,
      idempotencyKey,
    });

    // ── Persist everything in a transaction ─────────────────────────
    const result = await db.$transaction(async (tx) => {
      // Create or update the conversation
      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            candidateId: candidate.id,
            linqChatId: sendResult.linqChatId,
          },
        });
      }

      // Create the outbound message record
      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
          body: introMessage,
          linqMessageId: sendResult.linqMessageId,
          idempotencyKey,
          status: sendResult.status,
          sentAt: sendResult.status === "SENT" || sendResult.status === "QUEUED"
            ? new Date()
            : null,
        },
      });

      // Record message lifecycle event
      await tx.messageEvent.create({
        data: {
          messageId: message.id,
          status: sendResult.status,
          metadata: { event: "sent", linqMessageId: sendResult.linqMessageId },
        },
      });

      // Advance screening to STARTED
      await tx.screening.update({
        where: { id: screeningId },
        data: { state: "STARTED", startedAt: new Date() },
      });

      // Update candidate status
      await tx.candidate.update({
        where: { id: candidate.id },
        data: { status: "SCREENING" },
      });

      return { screening, message, conversation: conversation! };
    });

    // ── Audit ───────────────────────────────────────────────────────
    await audit.screeningStarted(candidate.id, screeningId, actorId, candidate.name);
    await audit.messageSent(result.message.id, candidate.id, { type: "intro" });

    screeningLogger.info({
      msg: "Screening started successfully",
      screeningId,
      candidateId: candidate.id,
      linqChatId: sendResult.linqChatId,
      linqMessageId: sendResult.linqMessageId,
    });

    return {
      screeningId,
      messageId: result.message.id,
      linqChatId: sendResult.linqChatId,
    };
  },

  /**
   * Handle an inbound SMS reply from a candidate.
   *
   * 1. Look up the screening via the Linq chat ID
   * 2. Validate the state machine transition
   * 3. Persist the response (if in a question state)
   * 4. Send the next question (or completion message)
   * 5. Advance the screening state
   */
  async handleInboundReply(
    linqChatId: string,
    replyText: string,
    inboundLinqMessageId?: string
  ): Promise<ProcessReplyResult> {
    const conversation = await messageRepository.findConversationByLinqChatId(
      linqChatId
    );

    if (!conversation) {
      screeningLogger.warn({
        msg: "Received reply for unknown chat",
        linqChatId,
      });
      return { consumed: false, nextState: "FAILED" };
    }

    const screening = await screeningRepository.findActiveForCandidate(
      conversation.candidateId
    );

    if (!screening) {
      screeningLogger.info({
        msg: "No active screening found for candidate",
        candidateId: conversation.candidateId,
        linqChatId,
      });
      return { consumed: false, nextState: "COMPLETED" };
    }

    if (!shouldProcessReply(screening.state)) {
      screeningLogger.debug({
        msg: "Ignoring reply in non-processable state",
        state: screening.state,
        candidateId: conversation.candidateId,
      });
      return { consumed: false, nextState: screening.state };
    }

    const questions = await screeningRepository.getActiveQuestions();
    const totalQuestions = questions.length;

    const nextState = computeNextState(
      screening.state,
      replyText,
      totalQuestions
    );

    // Always persist the inbound message for the conversation timeline,
    // even if the state won't change (e.g. non-START reply while STARTED).
    const stateAdvances = nextState !== screening.state;

    if (!stateAdvances) {
      await db.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          body: replyText,
          linqMessageId: inboundLinqMessageId,
          status: "RECEIVED",
        },
      });
      return { consumed: false, nextState };
    }

    screeningLogger.info({
      msg: "Processing screening reply",
      candidateId: conversation.candidateId,
      screeningId: screening.id,
      fromState: screening.state,
      toState: nextState,
      replyPreview: replyText.slice(0, 50),
    });

    const fromPhone = process.env.LINQ_FROM_PHONE!;

    // ── Fetch candidate (needed for completion message name + phone for `to`) ─
    const candidate = await db.candidate.findUnique({
      where: { id: conversation.candidateId },
      select: { name: true, phone: true },
    });

    // ── Determine what to send next ──────────────────────────────────
    let outboundBody: string | null = null;
    if (nextState === "COMPLETED") {
      outboundBody = buildCompletionMessage(candidate?.name ?? "Candidate");
    } else if (isQuestionState(nextState)) {
      const questionIndex = stateToQuestionIndex(nextState);
      const question = questions[questionIndex];
      if (question) {
        outboundBody = buildQuestionMessage(question, questionIndex, totalQuestions);
      }
    }

    const outboundIdempotencyKey = outboundBody
      ? `screening-q-${screening.id}-${nextState}-${nanoid(8)}`
      : null;

    let sendResult: import("@/types").SendMessageResult | null = null;
    if (outboundBody) {
      try {
        sendResult = await messagingProvider.sendMessage({
          linqChatId,
          to: candidate?.phone ?? "",
          from: fromPhone,
          body: outboundBody,
          idempotencyKey: outboundIdempotencyKey!,
        });
      } catch (sendErr) {
        if (nextState !== "COMPLETED") {
          // For question transitions: hard-fail so the candidate re-sends their answer
          throw sendErr;
        }
        // For COMPLETED: log but continue — all answers are collected regardless
        screeningLogger.error({
          msg: "Failed to send completion message; advancing screening to COMPLETED anyway",
          screeningId: screening.id,
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
    }

    // ── Persist everything in a transaction ─────────────────────────
    const transactionResult = await db.$transaction(async (tx) => {
      // Persist the inbound message
      const inboundMessage = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          body: replyText,
          linqMessageId: inboundLinqMessageId,
          status: "RECEIVED",
        },
      });

      await tx.messageEvent.create({
        data: {
          messageId: inboundMessage.id,
          status: "RECEIVED",
          metadata: { linqMessageId: inboundLinqMessageId },
        },
      });

      // If we were in a question state, save the response
      if (isQuestionState(screening.state)) {
        const questionIndex = stateToQuestionIndex(screening.state);
        const question = questions[questionIndex];
        if (question) {
          await tx.screeningResponse.create({
            data: {
              screeningId: screening.id,
              questionId: question.id,
              rawText: replyText,
              receivedMessageId: inboundMessage.id,
            },
          });
        }
      }

      // Persist the outbound message (next question or completion)
      let outboundMessage = null;
      if (outboundBody && sendResult) {
        outboundMessage = await tx.message.create({
          data: {
            conversationId: conversation.id,
            direction: "OUTBOUND",
            body: outboundBody,
            linqMessageId: sendResult.linqMessageId,
            idempotencyKey: outboundIdempotencyKey,
            status: sendResult.status,
            sentAt: new Date(),
          },
        });

        await tx.messageEvent.create({
          data: {
            messageId: outboundMessage.id,
            status: sendResult.status,
            metadata: { state: nextState, linqMessageId: sendResult.linqMessageId },
          },
        });
      }

      // Advance screening state
      const updatedScreening = await tx.screening.update({
        where: { id: screening.id },
        data: {
          state: nextState,
          currentQuestionIndex: isQuestionState(nextState)
            ? stateToQuestionIndex(nextState)
            : screening.currentQuestionIndex,
          ...(nextState === "COMPLETED"
            ? { completedAt: new Date() }
            : {}),
        },
      });

      // Update candidate status on completion
      if (nextState === "COMPLETED") {
        await tx.candidate.update({
          where: { id: conversation.candidateId },
          data: { status: "COMPLETED" },
        });
      }

      return { inboundMessage, outboundMessage, updatedScreening };
    });

    // ── Audit ───────────────────────────────────────────────────────
    await audit.messageReceived(transactionResult.inboundMessage.id, conversation.candidateId, {
      screeningState: screening.state,
    });

    if (transactionResult.outboundMessage) {
      await audit.messageSent(transactionResult.outboundMessage.id, conversation.candidateId, { nextState });
    }

    if (nextState === "COMPLETED") {
      await audit.screeningCompleted(conversation.candidateId, screening.id, candidate?.name ?? undefined);
    }

    return {
      consumed: true,
      nextState,
      messageId: transactionResult.outboundMessage?.id,
    };
  },

  /**
   * Mark a screening as failed due to a delivery failure.
   */
  async failScreening(
    screeningId: string,
    reason: string
  ): Promise<void> {
    let candidateId: string | undefined;
    let candidateName: string | undefined;

    await db.$transaction(async (tx) => {
      const screening = await tx.screening.update({
        where: { id: screeningId },
        data: {
          state: "FAILED",
          failedAt: new Date(),
          failureReason: reason,
        },
        include: { candidate: { select: { id: true, name: true } } },
      });

      candidateId = screening.candidateId;
      candidateName = screening.candidate?.name ?? undefined;

      await tx.candidate.update({
        where: { id: screening.candidateId },
        data: { status: "FAILED" },
      });
    });

    if (candidateId) {
      await audit.screeningFailed(candidateId, screeningId, reason, candidateName);
    }
  },
};

// Re-export for easier testing
export { computeNextState, shouldProcessReply } from "./state-machine";
