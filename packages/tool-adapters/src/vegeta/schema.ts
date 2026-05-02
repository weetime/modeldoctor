import { z } from "zod";

export const vegetaParamsSchema = z.object({
  apiType: z.enum(["chat", "embeddings", "rerank", "images", "chat-vision", "chat-audio"]),
  rate: z.number().int().min(1).max(10_000),
  duration: z.number().int().min(1).max(3_600),
});
export type VegetaParams = z.infer<typeof vegetaParamsSchema>;

const vegetaLatencyDist = z.object({
  // All fields are normalized to milliseconds (number). The runtime
  // parser converts vegeta's mixed-unit text output ("45.6ms" / "1.2s" /
  // "300µs") to ms before validation.
  min: z.number(),
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
  max: z.number(),
});

export const vegetaReportSchema = z.object({
  requests: z.object({
    total: z.number().int().nonnegative(),
    rate: z.number().nonnegative(),
    throughput: z.number().nonnegative(),
  }),
  duration: z.object({
    totalSeconds: z.number(),
    attackSeconds: z.number(),
    waitSeconds: z.number(),
  }),
  latencies: vegetaLatencyDist,
  bytesIn: z.object({ total: z.number().int(), mean: z.number() }),
  bytesOut: z.object({ total: z.number().int(), mean: z.number() }),
  // Success is a percent in [0, 100], NOT a 0-1 ratio (matches vegeta CLI).
  success: z.number().min(0).max(100),
  statusCodes: z.record(z.number().int()),
  errors: z.array(z.string()),
});
export type VegetaReport = z.infer<typeof vegetaReportSchema>;

export const vegetaParamDefaults: Partial<VegetaParams> = {
  apiType: "chat",
  rate: 10,
  duration: 30,
};
