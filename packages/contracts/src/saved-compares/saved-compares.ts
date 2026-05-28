import { z } from "zod";

export const stageLabelsSchema = z.record(z.string(), z.string().min(1).max(64));
export type StageLabels = z.infer<typeof stageLabelsSchema>;

// Defense-in-depth: each benchmark must have a stage label, and the baseline
// (when set) must reference one of the benchmarks. The UI's create flows
// already build stageLabels from benchmarkIds, but this guards the server
// boundary against misconfigured callers.
const isValidCompareConfig = (s: {
  benchmarkIds: string[];
  stageLabels: Record<string, string>;
  baselineId?: string | null;
}): boolean => {
  const hasValidLabels = s.benchmarkIds.every((id) => id in s.stageLabels);
  const hasValidBaseline = !s.baselineId || s.benchmarkIds.includes(s.baselineId);
  return hasValidLabels && hasValidBaseline;
};

export const savedCompareSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    name: z.string().min(1).max(200),
    benchmarkIds: z.array(z.string()).max(10),
    stageLabels: stageLabelsSchema,
    baselineId: z.string().nullable(),
    context: z.string().nullable(),
    narrative: z.unknown().nullable(), // shape lives in compare-narrative.ts; kept loose here
    narrativeAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine((s) => s.benchmarkIds.length >= 2, {
    message: "validation.compareMinRuns",
    path: ["benchmarkIds"],
  })
  .refine((s) => s.benchmarkIds.length <= 10, {
    message: "validation.compareMaxRuns",
    path: ["benchmarkIds"],
  })
  .refine(isValidCompareConfig, {
    message: "validation.invalidCompareConfiguration",
    path: ["benchmarkIds"],
  });
export type SavedCompare = z.infer<typeof savedCompareSchema>;

export const createSavedCompareRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    benchmarkIds: z.array(z.string()).max(10),
    stageLabels: stageLabelsSchema,
    baselineId: z.string().nullable().optional(),
    context: z.string().max(10_000).nullable().optional(),
  })
  .refine((s) => s.benchmarkIds.length >= 2, {
    message: "validation.compareMinRuns",
    path: ["benchmarkIds"],
  })
  .refine((s) => s.benchmarkIds.length <= 10, {
    message: "validation.compareMaxRuns",
    path: ["benchmarkIds"],
  })
  .refine(isValidCompareConfig, {
    message: "validation.invalidCompareConfiguration",
    path: ["benchmarkIds"],
  });
export type CreateSavedCompareRequest = z.infer<typeof createSavedCompareRequestSchema>;

// Server-side hydrated detail response — backend fans out benchmarkIds
// and embeds the referenced rows (or marks them `missing`).
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

export type HydratedSavedCompare = SavedCompare & {
  benchmarks: HydratedBenchmarkRef[];
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
