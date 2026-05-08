import { z } from "zod";

export const genaiPerfParamsSchema = z.object({
  endpointType: z.enum(["chat", "completions", "embeddings", "rankings"]),
  numPrompts: z.number().int().positive().default(100),
  concurrency: z.number().int().positive().default(1),
  inputTokensMean: z.number().int().positive().optional(),
  inputTokensStddev: z.number().int().min(0).default(0),
  outputTokensMean: z.number().int().positive().optional(),
  outputTokensStddev: z.number().int().min(0).default(0),
  // Default false to match the working playbook
  // (docs/superpowers/specs/...handoff §3 / ai-loadbalancer-benchmark-playbook).
  // Streaming triggers a known parsing bug in genai-perf 0.0.16 against any
  // OpenAI-spec endpoint that emits a usage-only final chunk
  // (`"choices": []` + `usage`) — vLLM, Higress, and OpenAI itself when
  // stream_options.include_usage is set all do this. Users who explicitly
  // need TTFT / inter-token latency can flip this on at run time and accept
  // the failure mode (which our stderr-tail surface makes diagnosable).
  streaming: z.boolean().default(false),
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
  streaming: false,
  inputTokensStddev: 0,
  outputTokensStddev: 0,
};
