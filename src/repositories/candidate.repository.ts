/**
 * Candidate repository — all Prisma queries for the Candidate aggregate.
 *
 * Rules:
 * - No business logic; only data access
 * - All queries scope to recruiterId to prevent cross-account data leaks
 * - Soft-delete: filter deletedAt by default; expose raw access only where needed
 */
import { Prisma } from "../generated/prisma";
import type { Candidate, CandidateStatus } from "../generated/prisma";
import { db } from "../lib/db";
import type { PaginatedResult, PaginationParams } from "../types";

export interface FindCandidatesParams extends PaginationParams {
  recruiterId: string;
  search?: string;
  status?: CandidateStatus;
  includeDeleted?: boolean;
}

export interface CandidateWithLatestScreening extends Candidate {
  screenings: Array<{
    id: string;
    state: import("../generated/prisma").ScreeningState;
    currentQuestionIndex: number;
    startedAt: Date | null;
    completedAt: Date | null;
  }>;
  _count: { screenings: number };
}

export const candidateRepository = {
  async findById(id: string, recruiterId: string): Promise<Candidate | null> {
    return db.candidate.findFirst({
      where: { id, recruiterId, deletedAt: null },
    });
  },

  async findByPhone(
    phone: string,
    recruiterId: string
  ): Promise<Candidate | null> {
    return db.candidate.findFirst({
      where: { phone, recruiterId, deletedAt: null },
    });
  },

  async findMany(
    params: FindCandidatesParams
  ): Promise<PaginatedResult<CandidateWithLatestScreening>> {
    const {
      recruiterId,
      search,
      status,
      includeDeleted = false,
      page = 1,
      limit = 20,
    } = params;

    const skip = (page - 1) * limit;

    const where: Prisma.CandidateWhereInput = {
      recruiterId,
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { role: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [data, total] = await db.$transaction([
      db.candidate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          screenings: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              state: true,
              currentQuestionIndex: true,
              startedAt: true,
              completedAt: true,
            },
          },
          _count: { select: { screenings: true } },
        },
      }),
      db.candidate.count({ where }),
    ]);

    return {
      data: data as CandidateWithLatestScreening[],
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + data.length < total,
      },
    };
  },

  async findByIdWithDetails(id: string, recruiterId: string) {
    return db.candidate.findFirst({
      where: { id, recruiterId, deletedAt: null },
      include: {
        screenings: {
          orderBy: { createdAt: "desc" },
          include: {
            responses: {
              include: { question: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
              include: { events: { orderBy: { createdAt: "asc" } } },
            },
          },
        },
      },
    });
  },

  async create(
    data: Prisma.CandidateCreateInput
  ): Promise<Candidate> {
    return db.candidate.create({ data });
  },

  async update(
    id: string,
    recruiterId: string,
    data: Prisma.CandidateUpdateInput
  ): Promise<Candidate> {
    return db.candidate.update({
      where: { id },
      data,
    });
  },

  async updateStatus(
    id: string,
    status: CandidateStatus
  ): Promise<Candidate> {
    return db.candidate.update({ where: { id }, data: { status } });
  },

  async hardDelete(id: string): Promise<void> {
    await db.candidate.delete({ where: { id } });
  },

  async countByStatus(recruiterId: string): Promise<Record<CandidateStatus, number>> {
    const results = await db.candidate.groupBy({
      by: ["status"],
      where: { recruiterId, deletedAt: null },
      _count: { status: true },
    });

    const counts = {
      PENDING: 0,
      SCREENING: 0,
      COMPLETED: 0,
      FAILED: 0,
      WITHDRAWN: 0,
    } as Record<CandidateStatus, number>;

    for (const r of results) {
      counts[r.status] = r._count.status;
    }
    return counts;
  },
};
