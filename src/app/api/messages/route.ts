/**
 * GET /api/messages — list all messages with filters
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { messageRepository } from "@/repositories/message.repository";
import { withErrorHandler, successResponse } from "@/lib/errors/api-handler";
import { ValidationError, UnauthorizedError } from "@/lib/errors";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z
    .enum(["PENDING", "QUEUED", "SENT", "DELIVERED", "RECEIVED", "READ", "FAILED"])
    .optional(),
  search: z.string().max(200).optional(),
});

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();

  const { searchParams } = req.nextUrl;
  const query = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!query.success) {
    throw new ValidationError("Invalid query parameters", query.error.flatten());
  }

  const result = await messageRepository.findAll({ ...query.data, recruiterId: session.user.id });
  return successResponse(result);
});
