/**
 * Database seed script.
 *
 * Creates realistic demo data:
 * - 1 recruiter account (email: demo@candidateflow.io / password: Demo1234!)
 * - 4 screening questions
 * - 8 candidates across all statuses
 * - Message history, delivery events, failures, and retries
 *
 * Run: npm run seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config(); // fallback to .env
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

// ── Screening questions ──────────────────────────────────────────────────────

const SCREENING_QUESTIONS = [
  {
    orderIndex: 0,
    prompt: "How many years of professional software engineering experience do you have?",
  },
  {
    orderIndex: 1,
    prompt: "Have you worked with React professionally? (yes/no)",
  },
  {
    orderIndex: 2,
    prompt: "Have you worked remotely before? (yes/no)",
  },
  {
    orderIndex: 3,
    prompt: "Are you legally authorized to work in the United States? (yes/no)",
  },
];

// ── Candidate seed data ──────────────────────────────────────────────────────

const CANDIDATES = [
  {
    name: "Sarah Chen",
    phone: "+12125551001",
    role: "Software Engineer",
    status: "COMPLETED" as const,
    screening: {
      state: "COMPLETED" as const,
      responses: ["5 years", "Yes", "Yes", "Yes"],
    },
  },
  {
    name: "Marcus Johnson",
    phone: "+12125551002",
    role: "Frontend Developer",
    status: "SCREENING" as const,
    screening: {
      state: "QUESTION_2" as const,
      responses: ["3 years"],
    },
  },
  {
    name: "Elena Rodriguez",
    phone: "+12125551003",
    role: "Full Stack Engineer",
    status: "SCREENING" as const,
    screening: {
      state: "STARTED" as const,
      responses: [],
    },
  },
  {
    name: "James Williams",
    phone: "+12125551004",
    role: "Backend Engineer",
    status: "FAILED" as const,
    screening: {
      state: "FAILED" as const,
      responses: [],
      failureReason: "SMS delivery failed after 5 retry attempts",
    },
  },
  {
    name: "Aisha Patel",
    phone: "+12125551005",
    role: "DevOps Engineer",
    status: "PENDING" as const,
    screening: null,
  },
  {
    name: "David Kim",
    phone: "+12125551006",
    role: "Software Engineer",
    status: "COMPLETED" as const,
    screening: {
      state: "COMPLETED" as const,
      responses: ["7 years", "Yes", "No", "Yes"],
    },
  },
  {
    name: "Rachel Thompson",
    phone: "+12125551007",
    role: "Mobile Developer",
    status: "PENDING" as const,
    screening: null,
  },
  {
    name: "Omar Hassan",
    phone: "+12125551008",
    role: "Platform Engineer",
    status: "WITHDRAWN" as const,
    screening: null,
  },
];

// ── Seed function ────────────────────────────────────────────────────────────

async function seed() {
  console.log("🌱 Starting seed...\n");

  // ── Clean existing data ──────────────────────────────────────────
  console.log("  Clearing existing data...");
  await db.auditLog.deleteMany();
  await db.retryJob.deleteMany();
  await db.messageEvent.deleteMany();
  await db.screeningResponse.deleteMany();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.screening.deleteMany();
  await db.screeningQuestion.deleteMany();
  await db.candidate.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.user.deleteMany();
  console.log("  ✓ Cleared\n");

  // ── Create recruiter ─────────────────────────────────────────────
  console.log("  Creating recruiter account...");
  const passwordHash = await bcrypt.hash("Demo1234!", 12);
  const recruiter = await db.user.create({
    data: {
      name: "Alex Recruiter",
      email: "demo@candidateflow.io",
      passwordHash,
      role: "RECRUITER",
    },
  });
  console.log(`  ✓ Recruiter: ${recruiter.email} (password: Demo1234!)\n`);

  // ── Create screening questions ───────────────────────────────────
  console.log("  Creating screening questions...");
  const questions = await Promise.all(
    SCREENING_QUESTIONS.map((q) => db.screeningQuestion.create({ data: q }))
  );
  console.log(`  ✓ ${questions.length} questions created\n`);

  // ── Create candidates ────────────────────────────────────────────
  console.log("  Creating candidates...");
  for (const candidateData of CANDIDATES) {
    const { screening: screeningData, ...candidateFields } = candidateData;

    const candidate = await db.candidate.create({
      data: {
        ...candidateFields,
        recruiterId: recruiter.id,
      },
    });

    // Create audit log for candidate creation
    await db.auditLog.create({
      data: {
        actorId: recruiter.id,
        action: "CANDIDATE_CREATED",
        entityType: "Candidate",
        entityId: candidate.id,
        metadata: { name: candidate.name, phone: candidate.phone },
      },
    });

    if (!screeningData) {
      console.log(`  ✓ ${candidate.name} (${candidate.status})`);
      continue;
    }

    // Create conversation
    const conversation = await db.conversation.create({
      data: {
        candidateId: candidate.id,
        linqChatId: `chat-seed-${candidate.id.slice(-8)}`,
      },
    });

    // Create screening record
    const screening = await db.screening.create({
      data: {
        candidateId: candidate.id,
        state: screeningData.state,
        currentQuestionIndex: screeningData.responses.length,
        startedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        completedAt: screeningData.state === "COMPLETED" ? new Date() : null,
        failedAt: screeningData.state === "FAILED" ? new Date() : null,
        failureReason: "failureReason" in screeningData ? screeningData.failureReason : null,
      },
    });

    await db.auditLog.create({
      data: {
        actorId: recruiter.id,
        action: "SCREENING_STARTED",
        entityType: "Screening",
        entityId: screening.id,
        metadata: { candidateId: candidate.id },
      },
    });

    // Create intro outbound message
    const introMessage = await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        body: `Hi ${candidate.name.split(" ")[0]}, thanks for applying for the ${candidate.role} role. We'd like to ask you a few quick screening questions. Reply START to begin.`,
        linqMessageId: `msg-seed-intro-${candidate.id.slice(-8)}`,
        idempotencyKey: `screening-intro-seed-${candidate.id}`,
        status: screeningData.state === "FAILED" ? "FAILED" : "SENT",
        sentAt: new Date(Date.now() - Math.random() * 6 * 24 * 60 * 60 * 1000),
        failedAt: screeningData.state === "FAILED" ? new Date() : null,
        errorCode: screeningData.state === "FAILED" ? "4001" : null,
        errorReason: screeningData.state === "FAILED" ? "Delivery timeout" : null,
      },
    });

    await db.messageEvent.create({
      data: {
        messageId: introMessage.id,
        status: "SENT",
        metadata: { event: "sent", seed: true },
      },
    });

    // Create a failed retry job for the failed candidate
    if (screeningData.state === "FAILED") {
      await db.retryJob.create({
        data: {
          messageId: introMessage.id,
          attempt: 5,
          maxAttempts: 5,
          nextRunAt: new Date(),
          status: "DEAD_LETTER",
          lastError: "Delivery timeout after 5 attempts",
        },
      });

      await db.auditLog.create({
        data: {
          action: "RETRY_DEAD_LETTERED",
          entityType: "Message",
          entityId: introMessage.id,
          metadata: { totalAttempts: 5 },
        },
      });
    }

    // Create START reply and question responses
    if (
      screeningData.state !== "STARTED" &&
      screeningData.state !== "FAILED"
    ) {
      // Inbound START
      const startMessage = await db.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          body: "START",
          linqMessageId: `msg-seed-start-${candidate.id.slice(-8)}`,
          status: "RECEIVED",
        },
      });

      // Create responses
      for (let i = 0; i < screeningData.responses.length; i++) {
        const question = questions[i];
        const questionMsg = await db.message.create({
          data: {
            conversationId: conversation.id,
            direction: "OUTBOUND",
            body: `Question ${i + 1} of ${questions.length}: ${question.prompt}`,
            linqMessageId: `msg-seed-q${i + 1}-${candidate.id.slice(-8)}`,
            idempotencyKey: `screening-q-seed-${screening.id}-${i}`,
            status: "SENT",
            sentAt: new Date(),
          },
        });

        const responseMsg = await db.message.create({
          data: {
            conversationId: conversation.id,
            direction: "INBOUND",
            body: screeningData.responses[i],
            linqMessageId: `msg-seed-r${i + 1}-${candidate.id.slice(-8)}`,
            status: "RECEIVED",
          },
        });

        await db.screeningResponse.create({
          data: {
            screeningId: screening.id,
            questionId: question.id,
            rawText: screeningData.responses[i],
            receivedMessageId: responseMsg.id,
          },
        });
      }

      if (screeningData.state === "COMPLETED") {
        // Add completion message
        await db.message.create({
          data: {
            conversationId: conversation.id,
            direction: "OUTBOUND",
            body: `Thank you, ${candidate.name.split(" ")[0]}! We've received all your answers. Our team will review your responses and be in touch soon.`,
            linqMessageId: `msg-seed-complete-${candidate.id.slice(-8)}`,
            idempotencyKey: `screening-complete-seed-${screening.id}`,
            status: "SENT",
            sentAt: new Date(),
          },
        });

        await db.auditLog.create({
          data: {
            action: "SCREENING_COMPLETED",
            entityType: "Screening",
            entityId: screening.id,
            metadata: { candidateId: candidate.id },
          },
        });
      }
    }

    console.log(`  ✓ ${candidate.name} (${candidate.status}, ${screeningData.state})`);
  }

  // ── Create sample webhook events ─────────────────────────────────
  console.log("\n  Creating sample webhook events...");
  const webhookEvents = [
    {
      linqEventId: "wh-seed-001",
      eventType: "message.sent",
      status: "PROCESSED" as const,
      rawPayload: { event_type: "message.sent", data: { id: "msg-example" } },
    },
    {
      linqEventId: "wh-seed-002",
      eventType: "message.received",
      status: "PROCESSED" as const,
      rawPayload: { event_type: "message.received", data: { chat: { id: "chat-example" } } },
    },
    {
      linqEventId: "wh-seed-003",
      eventType: "message.failed",
      status: "FAILED" as const,
      rawPayload: { event_type: "message.failed", data: { id: "msg-failed" } },
      errorMessage: "Handler error: Message not found",
    },
    {
      linqEventId: "wh-seed-004",
      eventType: "message.sent",
      status: "DUPLICATE" as const,
      rawPayload: { event_type: "message.sent", data: { id: "msg-example" } },
    },
  ];

  for (const wh of webhookEvents) {
    await db.webhookEvent.create({
      data: {
        linqEventId: wh.linqEventId,
        eventType: wh.eventType,
        status: wh.status,
        rawPayload: wh.rawPayload,
        errorMessage: wh.errorMessage,
        processedAt: wh.status === "PROCESSED" ? new Date() : null,
      },
    });
  }
  console.log(`  ✓ ${webhookEvents.length} webhook events created`);

  console.log("\n✅ Seed complete!\n");
  console.log("  Login: demo@candidateflow.io");
  console.log("  Password: Demo1234!");
  console.log("\n  Run `npm run dev` to start the application.");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
