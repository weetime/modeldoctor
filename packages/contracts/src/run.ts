import { z } from "zod";
import { baselineSummarySchema } from "./baseline.js";

export const runKindSchema = z.enum(["benchmark", "e2e"]);
export type RunKind = z.infer<typeof runKindSchema>;

export const runToolSchema = z.enum(["guidellm", "genai-perf", "vegeta", "e2e", "custom"]);
export type RunTool = z.infer<typeof runToolSchema>;

export const runModeSchema = z.enum([
  "fixed",
  "ramp-up",
  "throughput",
  "sla-target",
  "correctness",
]);
export type RunMode = z.infer<typeof runModeSchema>;

export const runStatusSchema = z.enum([
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runDriverKindSchema = z.enum(["local", "k8s"]);
export type RunDriverKind = z.infer<typeof runDriverKindSchema>;

export const runConnectionRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type RunConnectionRef = z.infer<typeof runConnectionRefSchema>;

export const runSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  connectionId: z.string().nullable(),
  // Resolved connection (id + name) when the connection still exists; null if
  // the row was orphaned by a Connection delete (FK is ON DELETE SET NULL).
  connection: runConnectionRefSchema.nullable(),

  kind: runKindSchema,
  tool: runToolSchema,
  scenario: z.record(z.unknown()),
  mode: runModeSchema,
  driverKind: runDriverKindSchema,

  name: z.string().nullable(),
  description: z.string().nullable(),

  status: runStatusSchema,
  statusMessage: z.string().nullable(),
  progress: z.number().nullable(),

  driverHandle: z.string().nullable(),

  params: z.record(z.unknown()),
  rawOutput: z.record(z.unknown()).nullable(),
  summaryMetrics: z.record(z.unknown()).nullable(),
  serverMetrics: z.record(z.unknown()).nullable(),

  templateId: z.string().nullable(),
  templateVersion: z.string().nullable(),
  parentRunId: z.string().nullable(),
  baselineId: z.string().nullable(),

  logs: z.string().nullable(),

  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),

  // Populated by GET /runs/:id when this Run is the canonical Run of a
  // baseline (Baseline.runId === this.id). Null otherwise.
  baselineFor: baselineSummarySchema.nullable(),
});
export type Run = z.infer<typeof runSchema>;

export const listRunsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  kind: runKindSchema.optional(),
  tool: runToolSchema.optional(),
  status: runStatusSchema.optional(),
  connectionId: z.string().optional(),
  parentRunId: z.string().optional(),
  search: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  isBaseline: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  referencesBaseline: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

export const listRunsResponseSchema = z.object({
  items: z.array(runSchema),
  nextCursor: z.string().nullable(),
});
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;

// ============================================================
// New unified create endpoint (POST /api/runs body)
// Phase 2 (#53). Old POST /api/benchmarks and POST /api/load-test
// keep their existing bodies and remain in service.
// ============================================================

export const createRunRequestSchema = z.object({
  tool: runToolSchema,
  kind: runKindSchema.default("benchmark"),
  connectionId: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  // adapter.paramsSchema is applied in the service layer; here we
  // only require the field to be a record so generic transport works.
  params: z.record(z.unknown()),
  templateId: z.string().optional(),
  templateVersion: z.string().optional(),
  parentRunId: z.string().optional(),
  baselineId: z.string().optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

// ============================================================
// Internal callback schemas v2 (runner pod → API)
// Phase 2 (#53). Old /api/internal/benchmarks/:id/{state,metrics}
// keep working in parallel during this phase.
// ============================================================

export const runStateCallbackSchema = z.object({
  state: z.literal("running"),
});
export type RunStateCallback = z.infer<typeof runStateCallbackSchema>;

export const runLogCallbackSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  lines: z.array(z.string().max(64 * 1024)).max(2000),
});
export type RunLogCallback = z.infer<typeof runLogCallbackSchema>;

export const runFinishCallbackSchema = z.object({
  state: z.enum(["completed", "failed"]),
  exitCode: z.number().int(),
  // Full stdout/stderr captured during the run; capped on the runner
  // side to ~16 KB tail apiece for /log live stream, but /finish ships
  // the full text. The /finish endpoint raises body-size to 10 MB to
  // accommodate full reports + outputs.
  stdout: z.string(),
  stderr: z.string(),
  // alias → base64-encoded file bytes. Aliases are stable per-tool and
  // align with the adapter's BuildCommandResult.outputFiles map.
  files: z.record(z.string()),
  message: z.string().max(2048).optional(),
});
export type RunFinishCallback = z.infer<typeof runFinishCallbackSchema>;
