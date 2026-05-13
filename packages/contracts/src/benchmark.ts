import { z } from "zod";
import { baselineSummarySchema } from "./baseline.js";
import { ModalityCategorySchema } from "./modality.js";

// ── Discriminators ───────────────────────────────────────────────────
export const scenarioIdSchema = z.enum([
  "inference",
  "capacity",
  "gateway",
  "prefix-cache-validation",
  "kv-cache-stress",
]);
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export const benchmarkToolSchema = z.enum([
  "guidellm",
  "genai-perf",
  "vegeta",
  "prefix-cache-probe",
  "kv-cache-stress",
  "evalscope",
]);
export type BenchmarkTool = z.infer<typeof benchmarkToolSchema>;

export const benchmarkStatusSchema = z.enum([
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
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

// ── Internal callback schemas (runner pod → API) ─────────────────────
export const benchmarkStateCallbackSchema = z.object({
  state: z.literal("running"),
  toolVersion: z.string().max(50).optional(),
});
export type BenchmarkStateCallback = z.infer<typeof benchmarkStateCallbackSchema>;

export const benchmarkLogCallbackSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  lines: z.array(z.string().max(64 * 1024)).max(2000),
});
export type BenchmarkLogCallback = z.infer<typeof benchmarkLogCallbackSchema>;

export const benchmarkFinishCallbackSchema = z.object({
  state: z.enum(["completed", "failed"]),
  exitCode: z.number().int(),
  // Full stdout/stderr captured during the run; capped on the runner side
  // to ~16 KB tail apiece for /log live stream, but /finish ships the full
  // text. The /finish endpoint raises body-size to 10 MB to accommodate
  // full reports + outputs.
  stdout: z.string(),
  stderr: z.string(),
  // alias → base64-encoded file bytes. Aliases are stable per-tool and
  // align with the adapter's BuildCommandResult.outputFiles map.
  files: z.record(z.string()),
  message: z.string().max(2048).optional(),
});
export type BenchmarkFinishCallback = z.infer<typeof benchmarkFinishCallbackSchema>;

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
