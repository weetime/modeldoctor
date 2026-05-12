import { z } from "zod";

export const stageLabelsSchema = z.record(z.string(), z.string().min(1).max(64));
export type StageLabels = z.infer<typeof stageLabelsSchema>;

export const savedCompareSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    name: z.string().min(1).max(200),
    benchmarkIds: z.array(z.string()).max(10),
    evaluationRunIds: z.array(z.string()).max(10).default([]),
    stageLabels: stageLabelsSchema,
    baselineId: z.string().nullable(),
    context: z.string().nullable(),
    narrative: z.unknown().nullable(), // shape lives in compare-narrative.ts; kept loose here
    narrativeAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length >= 2, {
    message: "compare requires at least 2 runs total",
    path: ["benchmarkIds"],
  })
  .refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length <= 10, {
    message: "compare cannot include more than 10 runs total",
    path: ["benchmarkIds"],
  });
export type SavedCompare = z.infer<typeof savedCompareSchema>;

export const createSavedCompareRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    benchmarkIds: z.array(z.string()).max(10),
    evaluationRunIds: z.array(z.string()).max(10).default([]),
    stageLabels: stageLabelsSchema,
    baselineId: z.string().nullable().optional(),
    context: z.string().max(10_000).nullable().optional(),
  })
  .refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length >= 2, {
    message: "compare requires at least 2 runs total",
    path: ["benchmarkIds"],
  })
  .refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length <= 10, {
    message: "compare cannot include more than 10 runs total",
    path: ["benchmarkIds"],
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
