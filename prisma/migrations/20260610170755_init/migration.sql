-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('RECRUITER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'SCREENING', 'COMPLETED', 'FAILED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ScreeningState" AS ENUM ('PENDING', 'STARTED', 'QUESTION_1', 'QUESTION_2', 'QUESTION_3', 'QUESTION_4', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'RECEIVED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "RetryJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CANDIDATE_CREATED', 'CANDIDATE_UPDATED', 'CANDIDATE_DELETED', 'SCREENING_STARTED', 'SCREENING_COMPLETED', 'SCREENING_FAILED', 'MESSAGE_SENT', 'MESSAGE_DELIVERED', 'MESSAGE_FAILED', 'MESSAGE_RECEIVED', 'RETRY_ENQUEUED', 'RETRY_SUCCEEDED', 'RETRY_DEAD_LETTERED', 'WEBHOOK_RECEIVED', 'WEBHOOK_PROCESSED', 'WEBHOOK_FAILED', 'USER_LOGGED_IN', 'USER_LOGGED_OUT', 'USER_CREATED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'RECRUITER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screening" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "state" "ScreeningState" NOT NULL DEFAULT 'PENDING',
    "currentQuestionIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Screening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningQuestion" (
    "id" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScreeningQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningResponse" (
    "id" TEXT NOT NULL,
    "screeningId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "receivedMessageId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "linqChatId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "linqMessageId" TEXT,
    "idempotencyKey" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "errorReason" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "linqEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "rawPayload" JSONB NOT NULL,
    "processedPayload" JSONB,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetryJob" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "RetryJobStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "runAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RetryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "candidateId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Candidate_recruiterId_idx" ON "Candidate"("recruiterId");

-- CreateIndex
CREATE INDEX "Candidate_status_idx" ON "Candidate"("status");

-- CreateIndex
CREATE INDEX "Candidate_phone_idx" ON "Candidate"("phone");

-- CreateIndex
CREATE INDEX "Candidate_createdAt_idx" ON "Candidate"("createdAt");

-- CreateIndex
CREATE INDEX "Candidate_deletedAt_idx" ON "Candidate"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_recruiterId_phone_key" ON "Candidate"("recruiterId", "phone");

-- CreateIndex
CREATE INDEX "Screening_candidateId_idx" ON "Screening"("candidateId");

-- CreateIndex
CREATE INDEX "Screening_state_idx" ON "Screening"("state");

-- CreateIndex
CREATE INDEX "Screening_createdAt_idx" ON "Screening"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningQuestion_orderIndex_key" ON "ScreeningQuestion"("orderIndex");

-- CreateIndex
CREATE INDEX "ScreeningQuestion_orderIndex_idx" ON "ScreeningQuestion"("orderIndex");

-- CreateIndex
CREATE INDEX "ScreeningQuestion_active_idx" ON "ScreeningQuestion"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningResponse_receivedMessageId_key" ON "ScreeningResponse"("receivedMessageId");

-- CreateIndex
CREATE INDEX "ScreeningResponse_screeningId_idx" ON "ScreeningResponse"("screeningId");

-- CreateIndex
CREATE INDEX "ScreeningResponse_questionId_idx" ON "ScreeningResponse"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_candidateId_key" ON "Conversation"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_linqChatId_key" ON "Conversation"("linqChatId");

-- CreateIndex
CREATE INDEX "Conversation_linqChatId_idx" ON "Conversation"("linqChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_linqMessageId_key" ON "Message"("linqMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_idempotencyKey_key" ON "Message"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_linqMessageId_idx" ON "Message"("linqMessageId");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_direction_idx" ON "Message"("direction");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "MessageEvent_messageId_idx" ON "MessageEvent"("messageId");

-- CreateIndex
CREATE INDEX "MessageEvent_createdAt_idx" ON "MessageEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_linqEventId_key" ON "WebhookEvent"("linqEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_linqEventId_idx" ON "WebhookEvent"("linqEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventType_idx" ON "WebhookEvent"("eventType");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RetryJob_messageId_idx" ON "RetryJob"("messageId");

-- CreateIndex
CREATE INDEX "RetryJob_status_idx" ON "RetryJob"("status");

-- CreateIndex
CREATE INDEX "RetryJob_nextRunAt_idx" ON "RetryJob"("nextRunAt");

-- CreateIndex
CREATE INDEX "RetryJob_createdAt_idx" ON "RetryJob"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_candidateId_idx" ON "AuditLog"("candidateId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResponse" ADD CONSTRAINT "ScreeningResponse_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "Screening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResponse" ADD CONSTRAINT "ScreeningResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ScreeningQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResponse" ADD CONSTRAINT "ScreeningResponse_receivedMessageId_fkey" FOREIGN KEY ("receivedMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetryJob" ADD CONSTRAINT "RetryJob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
