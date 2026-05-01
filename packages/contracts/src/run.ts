import { z } from "zod";

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

export const runSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  connectionId: z.string().nullable(),

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
  canonicalReport: z.record(z.unknown()).nullable(),
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
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

export const listRunsResponseSchema = z.object({
  items: z.array(runSchema),
  nextCursor: z.string().nullable(),
});
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
