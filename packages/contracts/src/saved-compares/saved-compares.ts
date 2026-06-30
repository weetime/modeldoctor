import { z } from "zod";

export const stageLabelsSchema = z.record(z.string(), z.string().min(1).max(64));
export type StageLabels = z.infer<typeof stageLabelsSchema>;

export const classificationSchema = z.enum(["public", "partner", "internal"]);
export type Classification = z.infer<typeof classificationSchema>;

// Report archetype. null/absent = the default discrete side-by-side stage
// compare (one bar per run). "sweep" = parametric sweep: members are grouped
// into series (by connection) across a swept axis and rendered as
// metric-vs-axis line charts (see report-scenarios/sweep + SweepLineChart).
export const reportKindSchema = z.enum(["sweep"]);
export type ReportKind = z.infer<typeof reportKindSchema>;

// The per-run param forming the sweep x-axis. Currently only evalscope's
// `parallel` (concurrency); reserved for other tools' axes later.
export const sweepAxisSchema = z.enum(["parallel"]);
export type SweepAxis = z.infer<typeof sweepAxisSchema>;

// A compare in sweep mode is grouped by series (not capped per-run), so it
// admits many more members than the discrete side-by-side compare.
export const COMPARE_MAX_RUNS = 10;
export const SWEEP_MAX_RUNS = 50;

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
    benchmarkIds: z.array(z.string()).max(SWEEP_MAX_RUNS),
    stageLabels: stageLabelsSchema,
    baselineId: z.string().nullable(),
    context: z.string().nullable(),
    classification: classificationSchema.default("internal"),
    clientName: z.string().max(120).nullable(),
    version: z.number().int().positive().default(1),
    scenario: z.string().nullable().optional(),
    tool: z.string().nullable().optional(),
    reportKind: reportKindSchema.nullable().optional(),
    sweepAxis: sweepAxisSchema.nullable().optional(),
    narrative: z.unknown().nullable(), // shape lives in compare-narrative.ts; kept loose here
    narrativeAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine((s) => s.benchmarkIds.length >= 2, {
    message: "validation.compareMinRuns",
    path: ["benchmarkIds"],
  })
  .refine(
    (s) => s.benchmarkIds.length <= (s.reportKind === "sweep" ? SWEEP_MAX_RUNS : COMPARE_MAX_RUNS),
    {
      message: "validation.compareMaxRuns",
      path: ["benchmarkIds"],
    },
  )
  .refine(isValidCompareConfig, {
    message: "validation.invalidCompareConfiguration",
    path: ["benchmarkIds"],
  });
export type SavedCompare = z.infer<typeof savedCompareSchema>;

export const createSavedCompareRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    benchmarkIds: z.array(z.string()).max(SWEEP_MAX_RUNS),
    stageLabels: stageLabelsSchema,
    baselineId: z.string().nullable().optional(),
    context: z.string().max(10_000).nullable().optional(),
    classification: classificationSchema.optional(),
    clientName: z.string().max(120).nullable().optional(),
    reportKind: reportKindSchema.nullable().optional(),
    sweepAxis: sweepAxisSchema.nullable().optional(),
  })
  .refine((s) => s.benchmarkIds.length >= 2, {
    message: "validation.compareMinRuns",
    path: ["benchmarkIds"],
  })
  // Discrete compares cap at COMPARE_MAX_RUNS (one bar per run stays readable);
  // sweep compares group by series, so they admit up to SWEEP_MAX_RUNS.
  .refine(
    (s) => s.benchmarkIds.length <= (s.reportKind === "sweep" ? SWEEP_MAX_RUNS : COMPARE_MAX_RUNS),
    {
      message: "validation.compareMaxRuns",
      path: ["benchmarkIds"],
    },
  )
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
  /** Source connection id + resolved engine kind (Connection.serverKind, e.g.
   * "vllm" | "mindie" | "sglang"). Sweep mode groups runs into series by
   * connectionId and labels each series by engineKind. */
  connectionId?: string | null;
  engineKind?: string | null;
  summaryMetrics?: unknown;
  /** serverMetrics blob — carries serverMetrics.prefixCache for prefix-cache
   * figures (hit rate / top-pod share) in the compare report. */
  serverMetrics?: unknown;
  /** Pre-computed latency distribution (e2e CDF samples, ms) for guidellm/vegeta
   * runs — server attaches via BenchmarkChartsService so the pure FigureRenderer
   * can draw it without fetching. Null/absent when the tool carries no samples. */
  latencyCdf?: { samples: number[] } | null;
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
  reportKind: reportKindSchema.nullable().optional(),
  sweepAxis: sweepAxisSchema.nullable().optional(),
});
export type UpdateSavedCompareRequest = z.infer<typeof updateSavedCompareRequestSchema>;

export const listSavedComparesResponseSchema = z.object({
  items: z.array(savedCompareSchema),
});
export type ListSavedComparesResponse = z.infer<typeof listSavedComparesResponseSchema>;
