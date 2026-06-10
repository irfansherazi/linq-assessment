/**
 * GET /api/logs — system observability: audit logs, webhook events, retry jobs
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { auditLogRepository } from "@/repositories/audit-log.repository";
import { webhookEventRepository } from "@/repositories/webhook-event.repository";
import { retryJobRepository } from "@/repositories/retry-job.repository";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { ValidationError, UnauthorizedError } from "@/lib/errors";

const querySchema = z.object({
  type: z.enum(["audit", "webhooks", "retries"]).default("audit"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { searchParams } = req.nextUrl;
  const query = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!query.success) {
    throw new ValidationError("Invalid query parameters", query.error.flatten());
  }

  const { type, page, limit } = query.data;

  switch (type) {
    case "audit": {
      const result = await auditLogRepository.findMany({ page, limit, recruiterId: session.user.id });
      return successResponse(result);
    }
    case "webhooks": {
      const result = await webhookEventRepository.findMany({ page, limit });
      return successResponse(result);
    }
    case "retries": {
      const result = await retryJobRepository.findMany({ page, limit });
      return successResponse(result);
    }
  }
});
