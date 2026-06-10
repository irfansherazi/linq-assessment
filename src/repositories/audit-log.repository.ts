/**
 * AuditLog repository — write-only append log of significant actions.
 * Never updates or deletes audit records; only creates and reads.
 */
import { Prisma } from "@/generated/prisma";
import type { AuditLog, AuditAction } from "@/generated/prisma";
import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams } from "@/types";

const ACTOR_SELECT = { select: { name: true, email: true } } as const;
const CANDIDATE_SELECT = { select: { id: true, name: true } } as const;

export interface CreateAuditLogInput {
  actorId?: string;
  candidateId?: string;
  candidateName?: string; // stored as metadata.name — survives candidate deletion
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export const auditLogRepository = {
  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const metadata = input.candidateName
      ? { name: input.candidateName, ...(input.metadata ?? {}) }
      : input.metadata;
    return db.auditLog.create({
      data: {
        actorId: input.actorId,
        candidateId: input.candidateId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        requestId: input.requestId,
      },
    });
  },

  async findByEntityId(
    entityId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<AuditLog>> {
    const { page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;
    const where = { entityId };

    const [data, total] = await db.$transaction([
      db.auditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      db.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit), hasMore: skip + data.length < total },
    };
  },

  async findByCandidateScope(
    candidateId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResult<AuditLog>> {
    const { page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;
    // candidateId column is now a proper FK — single indexed equality check
    const where = { candidateId };

    const [data, total] = await db.$transaction([
      db.auditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      db.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit), hasMore: skip + data.length < total },
    };
  },

  async findMany(
    params: PaginationParams & {
      action?: AuditAction;
      actorId?: string;
      entityType?: string;
      recruiterId?: string;
    } = {}
  ): Promise<PaginatedResult<AuditLog & {
    actor: { name: string; email: string } | null;
    candidate: { id: string; name: string } | null;
  }>> {
    const { page = 1, limit = 50, action, actorId, entityType, recruiterId } = params;
    const skip = (page - 1) * limit;

    let where: Prisma.AuditLogWhereInput = {
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
      ...(entityType ? { entityType } : {}),
    };

    if (recruiterId) {
      const candidateIds = await db.candidate
        .findMany({ where: { recruiterId }, select: { id: true } })
        .then((rows) => rows.map((r) => r.id));

      where = {
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
        OR: [
          { actorId: recruiterId },
          { candidateId: { in: candidateIds } },
        ],
      };
    }

    const [data, total] = await db.$transaction([
      db.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { actor: ACTOR_SELECT, candidate: CANDIDATE_SELECT },
      }),
      db.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit), hasMore: skip + data.length < total },
    };
  },

  async findRecent(
    limit = 20,
    recruiterId?: string
  ): Promise<(AuditLog & {
    actor: { name: string; email: string } | null;
    candidate: { id: string; name: string } | null;
  })[]> {
    let where: Prisma.AuditLogWhereInput | undefined;

    if (recruiterId) {
      const candidateIds = await db.candidate
        .findMany({ where: { recruiterId }, select: { id: true } })
        .then((rows) => rows.map((r) => r.id));

      where = {
        OR: [
          { actorId: recruiterId },
          { candidateId: { in: candidateIds } },
        ],
      };
    }

    return db.auditLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { actor: ACTOR_SELECT, candidate: CANDIDATE_SELECT },
    });
  },
};
