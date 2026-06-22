import { z } from "zod";

export const stageLabelsSchema = z.record(z.string(), z.string().min(1).max(64));
export type StageLabels = z.infer<typeof stageLabelsSchema>;

export const classificationSchema = z.enum(["public", "partner", "internal"]);
export type Classification = z.infer<typeof classificationSchema>;

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
    classification: classificationSchema.default("internal"),
    clientName: z.string().max(120).nullable(),
    version: z.number().int().positive().default(1),
    scenario: z.string().nullable().optional(),
    tool: z.string().nullable().optional(),
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
    classification: classificationSchema.optional(),
    clientName: z.string().max(120).nullable().optional(),
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
  /** serverMetrics blob — carries serverMetrics.prefixCache for prefix-cache
   * figures (hit rate / top-pod share) in the compare report. */
  serverMetrics?: unknown;
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
  classification: classificationSchema.optional(),
  clientName: z.string().max(120).nullable().optional(),
});
export type UpdateSavedCompareRequest = z.infer<typeof updateSavedCompareRequestSchema>;

export const listSavedComparesResponseSchema = z.object({
  items: z.array(savedCompareSchema),
});
export type ListSavedComparesResponse = z.infer<typeof listSavedComparesResponseSchema>;
