/**
 * Screening repository — all Prisma queries for the Screening aggregate.
 */
import { Prisma } from "@/generated/prisma";
import type { Screening, ScreeningState, ScreeningQuestion } from "@/generated/prisma";
import { db } from "@/lib/db";

export const screeningRepository = {
  async findById(id: string): Promise<Screening | null> {
    return db.screening.findUnique({ where: { id } });
  },

  async findByCandidateId(candidateId: string): Promise<Screening | null> {
    return db.screening.findFirst({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
    });
  },

  async findActiveForCandidate(candidateId: string): Promise<Screening | null> {
    return db.screening.findFirst({
      where: {
        candidateId,
        state: {
          notIn: ["COMPLETED", "FAILED"],
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async findByIdWithResponses(id: string) {
    return db.screening.findUnique({
      where: { id },
      include: {
        candidate: true,
        responses: {
          include: { question: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  },

  async create(
    data: Prisma.ScreeningCreateInput
  ): Promise<Screening> {
    return db.screening.create({ data });
  },

  async updateState(
    id: string,
    state: ScreeningState,
    extras?: Partial<{
      currentQuestionIndex: number;
      startedAt: Date;
      completedAt: Date;
      failedAt: Date;
      failureReason: string;
    }>
  ): Promise<Screening> {
    return db.screening.update({
      where: { id },
      data: { state, ...extras },
    });
  },

  // ── Screening Questions ──────────────────────────────────────────────

  async getActiveQuestions(): Promise<ScreeningQuestion[]> {
    return db.screeningQuestion.findMany({
      where: { active: true },
      orderBy: { orderIndex: "asc" },
    });
  },

  async getQuestionByIndex(orderIndex: number): Promise<ScreeningQuestion | null> {
    return db.screeningQuestion.findFirst({
      where: { active: true, orderIndex },
    });
  },

  async countActiveQuestions(): Promise<number> {
    return db.screeningQuestion.count({ where: { active: true } });
  },

  async createResponse(data: Prisma.ScreeningResponseCreateInput) {
    return db.screeningResponse.create({ data });
  },

  async countByState(recruiterId: string): Promise<Record<ScreeningState, number>> {
    const results = await db.screening.groupBy({
      by: ["state"],
      where: { candidate: { recruiterId } },
      _count: { state: true },
    });

    const counts = {
      PENDING: 0,
      STARTED: 0,
      QUESTION_1: 0,
      QUESTION_2: 0,
      QUESTION_3: 0,
      QUESTION_4: 0,
      COMPLETED: 0,
      FAILED: 0,
    } as Record<ScreeningState, number>;

    for (const r of results) {
      counts[r.state] = r._count.state;
    }
    return counts;
  },
};
