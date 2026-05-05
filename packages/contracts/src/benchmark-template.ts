import { z } from "zod";
import { benchmarkToolSchema, scenarioIdSchema } from "./benchmark.js";

export const benchmarkTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  config: z.record(z.unknown()),
  isOfficial: z.boolean(),
  createdBy: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BenchmarkTemplate = z.infer<typeof benchmarkTemplateSchema>;

export const listBenchmarkTemplatesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  scenario: scenarioIdSchema.optional(),
  tool: benchmarkToolSchema.optional(),
  isOfficial: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  search: z.string().optional(),
});
export type ListBenchmarkTemplatesQuery = z.infer<typeof listBenchmarkTemplatesQuerySchema>;

export const listBenchmarkTemplatesResponseSchema = z.object({
  items: z.array(benchmarkTemplateSchema),
  nextCursor: z.string().nullable(),
});
export type ListBenchmarkTemplatesResponse = z.infer<typeof listBenchmarkTemplatesResponseSchema>;

export const createBenchmarkTemplateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2048).optional(),
  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  config: z.record(z.unknown()),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  isOfficial: z.boolean().default(false), // server enforces admin-only
});
export type CreateBenchmarkTemplateRequest = z.infer<typeof createBenchmarkTemplateRequestSchema>;

export const updateBenchmarkTemplateRequestSchema = createBenchmarkTemplateRequestSchema.partial();
export type UpdateBenchmarkTemplateRequest = z.infer<typeof updateBenchmarkTemplateRequestSchema>;

/**
 * PATCH /api/benchmark-templates/:id body schema. Strips isOfficial (immutable
 * post-create) + scenario/tool (changing these would invalidate stored config).
 * Server enforces; client mirrors so form types stay in sync.
 */
export const patchBenchmarkTemplateRequestSchema = updateBenchmarkTemplateRequestSchema.omit({
  isOfficial: true,
  scenario: true,
  tool: true,
});
export type PatchBenchmarkTemplateRequest = z.infer<typeof patchBenchmarkTemplateRequestSchema>;
