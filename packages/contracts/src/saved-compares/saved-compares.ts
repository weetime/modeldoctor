import { z } from "zod";

export const stageLabelsSchema = z.record(z.string(), z.string().min(1).max(64));
export type StageLabels = z.infer<typeof stageLabelsSchema>;

export const savedCompareSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(200),
  benchmarkIds: z.array(z.string()).min(2).max(10),
  stageLabels: stageLabelsSchema,
  baselineId: z.string().nullable(),
  context: z.string().nullable(),
  narrative: z.unknown().nullable(),       // shape lives in compare-narrative.ts; kept loose here
  narrativeAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedCompare = z.infer<typeof savedCompareSchema>;

export const createSavedCompareRequestSchema = z.object({
  name: z.string().min(1).max(200),
  benchmarkIds: z.array(z.string()).min(2).max(10),
  stageLabels: stageLabelsSchema,
  baselineId: z.string().nullable().optional(),
  context: z.string().max(10_000).nullable().optional(),
});
export type CreateSavedCompareRequest = z.infer<typeof createSavedCompareRequestSchema>;

export const updateSavedCompareRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  stageLabels: stageLabelsSchema.optional(),
  baselineId: z.string().nullable().optional(),
  context: z.string().max(10_000).nullable().optional(),
});
export type UpdateSavedCompareRequest = z.infer<typeof updateSavedCompareRequestSchema>;

export const listSavedComparesResponseSchema = z.object({
  items: z.array(savedCompareSchema),
});
export type ListSavedComparesResponse = z.infer<typeof listSavedComparesResponseSchema>;
