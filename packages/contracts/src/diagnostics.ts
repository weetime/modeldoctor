import { z } from "zod";

// ── Probes (mirror existing e2e-test.ts values; runner depends on these) ──
// Source-of-truth wire identifiers for diagnostics probes. Each id is
// dash-separated and explicitly names the wire shape (e.g. "rerank-tei"
// vs "rerank-cohere") so naming is unambiguous when a category contains
// multiple probes that hit different protocols.
export const probeNameSchema = z.enum([
  // chat (LLM)
  "chat-text",
  "chat-vision",
  // audio
  "tts",
  "asr",
  "chat-audio-omni",
  // embeddings
  "embeddings-openai",
  "embeddings-tei",
  // rerank
  "rerank-tei",
  "rerank-cohere",
  // image
  "image-gen",
]);
export type ProbeName = z.infer<typeof probeNameSchema>;

// ── Per-probe result ────────────────────────────────────────────────
export const probeCheckSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  info: z.string().optional(),
});
export type ProbeCheck = z.infer<typeof probeCheckSchema>;

export const probeResultSchema = z.object({
  probe: probeNameSchema,
  pass: z.boolean(),
  latencyMs: z.number().nullable(),
  checks: z.array(probeCheckSchema),
  details: z.record(z.unknown()).optional(),
});
export type ProbeResult = z.infer<typeof probeResultSchema>;

// ── Persisted row (DiagnosticsRun) ──────────────────────────────────
export const diagnosticsStatusSchema = z.enum(["completed", "failed"]);
export type DiagnosticsStatus = z.infer<typeof diagnosticsStatusSchema>;

export const diagnosticsRunSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  connectionId: z.string().nullable(),
  status: diagnosticsStatusSchema,
  statusMessage: z.string().nullable(),
  probes: z.array(probeNameSchema),
  pathOverride: z.record(z.unknown()),
  results: z.array(probeResultSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DiagnosticsRun = z.infer<typeof diagnosticsRunSchema>;

// ── Request bodies ──────────────────────────────────────────────────
export const diagnosticsRunRequestSchema = z.object({
  connectionId: z.string().min(1),
  probes: z.array(probeNameSchema).min(1),
  // Per-probe path override (path tail starting with "/"). Missing keys
  // fall back to runner-side defaults.
  pathOverride: z.record(z.string()).optional(),
});
export type DiagnosticsRunRequest = z.infer<typeof diagnosticsRunRequestSchema>;

export const diagnosticsRunResponseSchema = z.object({
  diagnosticsRunId: z.string(),
  success: z.boolean(),
  results: z.array(probeResultSchema),
});
export type DiagnosticsRunResponse = z.infer<typeof diagnosticsRunResponseSchema>;

// ── List query ──────────────────────────────────────────────────────
export const listDiagnosticsRunsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  connectionId: z.string().optional(),
});
export type ListDiagnosticsRunsQuery = z.infer<typeof listDiagnosticsRunsQuerySchema>;

export const listDiagnosticsRunsResponseSchema = z.object({
  items: z.array(diagnosticsRunSchema),
  nextCursor: z.string().nullable(),
});
export type ListDiagnosticsRunsResponse = z.infer<typeof listDiagnosticsRunsResponseSchema>;
