import { z } from "zod";

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format (e.g. +12125551234)");

export const createCandidateSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  phone: phoneSchema,
  role: z.string().min(1, "Role is required").max(255),
  notes: z.string().max(2000).optional(),
});

export const updateCandidateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.string().min(1).max(255).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const candidateQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  status: z
    .enum(["PENDING", "SCREENING", "COMPLETED", "FAILED", "WITHDRAWN"])
    .optional(),
});

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;
export type CandidateQuery = z.infer<typeof candidateQuerySchema>;
