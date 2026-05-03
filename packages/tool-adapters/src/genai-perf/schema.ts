import { z } from "zod";

export const genaiPerfParamsSchema = z.object({
  endpointType: z.enum(["chat", "completions", "embeddings", "rankings"]),
  numPrompts: z.number().int().positive().default(100),
  concurrency: z.number().int().positive().default(1),
  inputTokensMean: z.number().int().positive().optional(),
  inputTokensStddev: z.number().int().min(0).default(0),
  outputTokensMean: z.number().int().positive().optional(),
  outputTokensStddev: z.number().int().min(0).default(0),
  streaming: z.boolean().default(true),
  tokenizer: z.string().min(1).optional(),
});
export type GenaiPerfParams = z.infer<typeof genaiPerfParamsSchema>;

const genaiPerfDist = z.object({
  avg: z.number(),
  min: z.number(),
  max: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
  stddev: z.number(),
  unit: z.string(),
});

const sequenceLength = z.object({
  avg: z.number(),
  p50: z.number(),
  p99: z.number(),
});

export const genaiPerfReportSchema = z.object({
  requestThroughput: z.object({ avg: z.number(), unit: z.string() }),
  requestLatency: genaiPerfDist,
  timeToFirstToken: genaiPerfDist,
  interTokenLatency: genaiPerfDist,
  outputTokenThroughput: z.object({ avg: z.number(), unit: z.string() }),
  outputSequenceLength: sequenceLength,
  inputSequenceLength: sequenceLength,
});
export type GenaiPerfReport = z.infer<typeof genaiPerfReportSchema>;

export const genaiPerfParamDefaults: Partial<GenaiPerfParams> = {
  endpointType: "chat",
  numPrompts: 100,
  concurrency: 1,
  streaming: true,
  inputTokensStddev: 0,
  outputTokensStddev: 0,
};
