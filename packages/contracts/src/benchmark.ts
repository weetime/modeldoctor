import { z } from "zod";
import { baselineSummarySchema } from "./baseline.js";
import { panelUnitSchema } from "./engine-metrics.js";
import { ModalityCategorySchema } from "./modality.js";

// ── Discriminators ───────────────────────────────────────────────────
export const scenarioIdSchema = z.enum([
  "inference",
  "capacity",
  "gateway",
  "lb-strategy",
  "engine-kv-cache",
  "agent",
]);
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export const benchmarkToolSchema = z.enum(["guidellm", "vegeta", "evalscope", "aiperf", "tau3"]);
export type BenchmarkTool = z.infer<typeof benchmarkToolSchema>;

export const benchmarkStatusSchema = z.enum([
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
  "interrupted",
]);
export type BenchmarkStatus = z.infer<typeof benchmarkStatusSchema>;

export const benchmarkConnectionRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  baseUrl: z.string(),
});
export type BenchmarkConnectionRef = z.infer<typeof benchmarkConnectionRefSchema>;

// ── Persisted shape (GET /api/benchmarks/:id) ────────────────────────
export const benchmarkSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  connectionId: z.string().nullable(),
  // Resolved connection (id + name) when the connection still exists; null if
  // the row was orphaned by a Connection delete (FK is ON DELETE SET NULL).
  connection: benchmarkConnectionRefSchema.nullable(),

  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  toolVersion: z.string().nullable(),

  name: z.string(),
  // Optional short display label for the Compare stage axis. null = derive
  // from `name` via shortRunLabels. Set/cleared from the benchmark list.
  label: z.string().nullable(),
  description: z.string().nullable(),

  status: benchmarkStatusSchema,
  statusMessage: z.string().nullable(),
  progress: z.number().nullable(),

  driverHandle: z.string().nullable(),

  params: z.record(z.unknown()),
  rawOutput: z.record(z.unknown()).nullable(),
  summaryMetrics: z.record(z.unknown()).nullable(),
  serverMetrics: z.record(z.unknown()).nullable(),

  templateId: z.string().nullable(),
  parentBenchmarkId: z.string().nullable(),
  baselineId: z.string().nullable(),

  logs: z.string().nullable(),

  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),

  // Populated by GET /benchmarks/:id when this Benchmark is the canonical
  // benchmark of a baseline (Baseline.benchmarkId === this.id). Null otherwise.
  baselineFor: baselineSummarySchema.nullable(),
});
export type Benchmark = z.infer<typeof benchmarkSchema>;

// ── List query ───────────────────────────────────────────────────────
export const listBenchmarksQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  scenario: scenarioIdSchema.optional(),
  tool: benchmarkToolSchema.optional(),
  status: benchmarkStatusSchema.optional(),
  connectionId: z.string().optional(),
  parentBenchmarkId: z.string().optional(),
  templateId: z.string().optional(),
  search: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  isBaseline: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  referencesBaseline: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  scope: z.enum(["own", "all"]).default("own"),
});
export type ListBenchmarksQuery = z.infer<typeof listBenchmarksQuerySchema>;

export const listBenchmarksResponseSchema = z.object({
  items: z.array(benchmarkSchema),
  nextCursor: z.string().nullable(),
});
export type ListBenchmarksResponse = z.infer<typeof listBenchmarksResponseSchema>;

// ── Bulk delete ──────────────────────────────────────────────────────
// POST /api/benchmarks/bulk-delete — delete many rows in one request.
// Capped at 100 ids per call (mirrors the list page's max selection).
export const bulkDeleteBenchmarksRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});
export type BulkDeleteBenchmarksRequest = z.infer<typeof bulkDeleteBenchmarksRequestSchema>;

export const bulkDeleteBenchmarksResponseSchema = z.object({
  // Number of rows actually deleted — ids the caller didn't own or that
  // were already gone are silently skipped, so this can be < ids.length.
  deleted: z.number().int().nonnegative(),
});
export type BulkDeleteBenchmarksResponse = z.infer<typeof bulkDeleteBenchmarksResponseSchema>;

// ── Create request ───────────────────────────────────────────────────
export const createBenchmarkRequestSchema = z.object({
  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  connectionId: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  // adapter.paramsSchema is applied in the service layer; here we only
  // require the field to be a record so generic transport works.
  params: z.record(z.unknown()),
  templateId: z.string().optional(),
  parentBenchmarkId: z.string().optional(),
  baselineId: z.string().optional(),
});
export type CreateBenchmarkRequest = z.infer<typeof createBenchmarkRequestSchema>;

export const benchmarkUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  // Empty string is allowed on the wire; the service normalizes "" → null.
  label: z.string().max(48).nullable().optional(),
});
export type BenchmarkUpdateRequest = z.infer<typeof benchmarkUpdateSchema>;

// ── Charts response (GET /api/benchmarks/:id/charts) ─────────────────
// Server derives these from rawOutput.files.* on demand; not persisted.
export const histogramBucketSchema = z.object({
  lower: z.number(),
  upper: z.number(),
  count: z.number().int().nonnegative(),
});
export type HistogramBucket = z.infer<typeof histogramBucketSchema>;

export const benchmarkChartsResponseSchema = z.object({
  // Latency samples in milliseconds. Null when the source file is missing,
  // unparseable, or the tool has no per-request latency concept.
  latencyCdf: z.object({ samples: z.array(z.number()) }).nullable(),
  // TTFT bucket counts, equal-width bins in milliseconds. Null for tools
  // without a TTFT concept (vegeta) or when extraction fails.
  ttftHistogram: z.object({ buckets: z.array(histogramBucketSchema) }).nullable(),
});
export type BenchmarkChartsResponse = z.infer<typeof benchmarkChartsResponseSchema>;

// ── Endpoint reports (GET /api/benchmarks/reports/by-connection) ─────

export const endpointReportRangeSchema = z.enum(["7d", "30d", "90d"]);
export type EndpointReportRange = z.infer<typeof endpointReportRangeSchema>;

export const endpointReportSchema = z.object({
  connection: benchmarkConnectionRefSchema.extend({
    category: ModalityCategorySchema,
  }),
  totalRuns: z.number().int().nonnegative(),
  // Per-status row counts within the window. Success-rate denominator is
  // (completed + failed); canceled is user action, inProgress collapses
  // pending/submitted/running. Surfaced so the index card can show the
  // breakdown transparently.
  statusCounts: z.object({
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
  }),
  // % in [0, 100]; null when no terminal (completed|failed) runs in the window.
  successRate: z.number().min(0).max(100).nullable(),
  // p95 latency in ms (mirrors what FE compare/metrics.ts reads). first =
  // chronologically-earliest completed run with a usable p95; last =
  // chronologically-latest. null when no completed run carries metrics.
  p95Latency: z
    .object({
      first: z.number().nonnegative().nullable(),
      last: z.number().nonnegative().nullable(),
    })
    .nullable(),
  // Latest run regardless of status — drives "Latest: <name> · <when>".
  latestRun: z
    .object({
      id: z.string(),
      name: z.string(),
      status: benchmarkStatusSchema,
      createdAt: z.string().datetime(),
    })
    .nullable(),
});
export type EndpointReport = z.infer<typeof endpointReportSchema>;

export const endpointReportsResponseSchema = z.object({
  range: endpointReportRangeSchema,
  generatedAt: z.string().datetime(),
  items: z.array(endpointReportSchema),
});
export type EndpointReportsResponse = z.infer<typeof endpointReportsResponseSchema>;

// ── Report shared storage — Phase 2 of #237 ─────────────────────────
// Object keys the runner writes and ReportLoader reads.
// Keep in sync with apps/benchmark-runner/runner/storage_keys.py.
export const reportStorageKeys = (runId: string) => ({
  meta: `${runId}/meta.json`,
  result: `${runId}/result.json`,
  stdout: `${runId}/stdout.log`,
  stderr: `${runId}/stderr.log`,
  checkpointPrefix: `${runId}/checkpoint/`,
  file: (alias: string) => `${runId}/files/${alias}`,
});

export const reportMetaSchema = z.object({
  toolVersion: z.string().max(50),
  startTimeIso: z.string().datetime(),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

export const reportResultSchema = z.object({
  exitCode: z.number().int(),
  finishTimeIso: z.string().datetime(),
  files: z.record(z.string()), // alias → relative path under <runId>/
});
export type ReportResult = z.infer<typeof reportResultSchema>;

// Prometheus-derived prefix-cache annotation, snapshotted at benchmark
// completion and stored under `serverMetrics.prefixCache` (existing JSON
// column — no dedicated Prisma column). Surfaced by the prefix-cache panel.
export const prefixCacheAnnotationSchema = z.object({
  hitRatePct: z.number().min(0).max(100),
  topPodSharePct: z.number().min(0).max(100),
  perPod: z.array(
    z.object({
      pod: z.string(),
      queries: z.number().nonnegative(),
      hits: z.number().nonnegative(),
    }),
  ),
  metricTag: z.enum(["v1", "v0"]),
});
export type PrefixCacheAnnotation = z.infer<typeof prefixCacheAnnotationSchema>;

// Prometheus-derived engine-metrics annotation, snapshotted at benchmark
// completion (reusing the live EngineMetricsService.fetchSnapshot manifest)
// and stored under `serverMetrics.engineMetrics`. Each manifest metric is
// reduced to scalar `avg` + `peak` over the run window so historical compares
// survive Prometheus retention (the detail-page Engine Metrics tab stays live;
// compare/reports read this durable snapshot). `key` is the manifest's stable
// cross-engine key (e.g. "kv_cache_usage", "preemption_rate").
export const engineMetricScalarSchema = z.object({
  key: z.string(),
  unit: panelUnitSchema,
  avg: z.number().nullable(),
  peak: z.number().nullable(),
  // Optional saturation-duration stat: fraction (0..1) of window samples at or
  // above the metric's saturation threshold — e.g. KV cache ≥ 90%. Lets the
  // report distinguish a transient peak from a sustained saturation. Only
  // present for metrics with a defined threshold; absent on older snapshots.
  satFrac: z.number().nullable().optional(),
});
export const engineMetricsAnnotationSchema = z.object({
  capturedAt: z.string(),
  metrics: z.array(engineMetricScalarSchema),
});
export type EngineMetricScalar = z.infer<typeof engineMetricScalarSchema>;
export type EngineMetricsAnnotation = z.infer<typeof engineMetricsAnnotationSchema>;
