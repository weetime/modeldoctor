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
    message: "validation.compareMinRuns",
    path: ["benchmarkIds"],
  })
  .refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length <= 10, {
    message: "validation.compareMaxRuns",
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
    message: "validation.compareMinRuns",
    path: ["benchmarkIds"],
  })
  .refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length <= 10, {
    message: "validation.compareMaxRuns",
    path: ["benchmarkIds"],
  });
export type CreateSavedCompareRequest = z.infer<typeof createSavedCompareRequestSchema>;

// Server-side hydrated detail response — backend fans out benchmarkIds /
// evaluationRunIds and embeds the referenced rows (or marks them `missing`).
export interface HydratedBenchmarkRef {
  id: string;
  stageLabel: string;
  missing: boolean;
  name?: string | null;
  tool?: string;
  scenario?: string;
  summaryMetrics?: unknown;
  params?: unknown;
  createdAt?: string;
}

export interface HydratedEvaluationRunRef {
  id: string;
  stageLabel: string;
  missing: boolean;
  status?: string;
  gateResult?: string | null;
  aggregateMetrics?: unknown;
  createdAt?: string;
}

export type HydratedSavedCompare = SavedCompare & {
  benchmarks: HydratedBenchmarkRef[];
  evaluationRuns: HydratedEvaluationRunRef[];
};

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
