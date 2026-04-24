import { z } from "zod";

export const ApiTypeSchema = z.enum([
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
]);
export type ApiType = z.infer<typeof ApiTypeSchema>;

export const LoadTestRequestSchema = z
  .object({
    apiType: ApiTypeSchema.optional(),
    apiUrl: z.string().min(1),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    customHeaders: z.string().optional(),
    queryParams: z.string().optional(),
    rate: z.coerce.number().int().min(1).max(10_000),
    duration: z.coerce.number().int().min(1).max(3_600),
  })
  .passthrough();
export type LoadTestRequest = z.infer<typeof LoadTestRequestSchema>;

export const LoadTestParsedSchema = z.object({
  requests: z.number().nullable(),
  success: z.number().nullable(),
  throughput: z.number().nullable(),
  latencies: z.object({
    mean: z.string().nullable(),
    p50: z.string().nullable(),
    p95: z.string().nullable(),
    p99: z.string().nullable(),
    max: z.string().nullable(),
  }),
});
export type LoadTestParsed = z.infer<typeof LoadTestParsedSchema>;

export const LoadTestResponseSchema = z.object({
  success: z.literal(true),
  // Optional so the FE api-client keeps parsing responses produced before
  // Phase 4 introduced DB persistence; always present on Phase-4+ servers.
  runId: z.string().optional(),
  report: z.string(),
  parsed: LoadTestParsedSchema,
  config: z.object({
    apiType: ApiTypeSchema,
    apiUrl: z.string(),
    model: z.string(),
    rate: z.number(),
    duration: z.number(),
  }),
});
export type LoadTestResponse = z.infer<typeof LoadTestResponseSchema>;

export const LoadTestRunSummarySchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  apiType: ApiTypeSchema,
  apiUrl: z.string(),
  model: z.string(),
  rate: z.number(),
  duration: z.number(),
  status: z.enum(["completed", "failed"]),
  summaryJson: LoadTestParsedSchema.nullable(),
  createdAt: z.string(), // ISO
  completedAt: z.string().nullable(), // ISO
});
export type LoadTestRunSummary = z.infer<typeof LoadTestRunSummarySchema>;

export const ListLoadTestRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type ListLoadTestRunsQuery = z.infer<typeof ListLoadTestRunsQuerySchema>;

export const ListLoadTestRunsResponseSchema = z.object({
  items: z.array(LoadTestRunSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListLoadTestRunsResponse = z.infer<typeof ListLoadTestRunsResponseSchema>;
