import { z } from "zod";

// AIPerf (ai-dynamo/aiperf v0.7+) is NVIDIA's successor to genai-perf.
// It takes a `--url` base + `--endpoint-type {chat|completions|...}` rather
// than the full endpoint path; AIPerf auto-appends /v1/chat/completions
// (or /v1/completions) based on endpoint-type. Datasets default to a
// synthetic generator; `--public-dataset sharegpt` (or `aimo`) opts into
// a downloaded fixture set.
export const aiperfParamsSchema = z
  .object({
    concurrency: z.number().int().min(1).max(512).default(8),
    requestCount: z.number().int().min(1).max(10000).default(100),
    inputTokensMean: z.number().int().min(1).max(32000).default(1024),
    inputTokensStddev: z.number().int().min(0).max(8192).default(128),
    outputTokensMean: z.number().int().min(1).max(4096).default(256),
    outputTokensStddev: z.number().int().min(0).max(2048).default(64),
    endpointType: z.enum(["chat", "completions"]).default("chat"),
    streaming: z.boolean().default(true),
    // synthetic = AIPerf internal generator (closed-loop, --concurrency).
    // sharegpt = baked ShareGPT corpus (closed-loop).
    // mooncake-trace = baked Mooncake trace replayed open-loop (--fixed-schedule).
    dataset: z.enum(["synthetic", "sharegpt", "mooncake-trace"]).default("synthetic"),
    seed: z.number().int().optional(),

    // Multi-turn (closed-loop only). Each conversation reuses its growing
    // prefix turn-by-turn; this is what exercises prefix-cache routing.
    conversationNum: z.number().int().min(1).max(10000).optional(),
    conversationTurnMean: z.number().int().min(1).max(100).optional(),
    conversationTurnStddev: z.number().int().min(0).max(50).optional(),
    conversationType: z.enum(["pooled", "sticky-user-sessions"]).optional(),
    conversationTurnDelayMeanMs: z.number().int().min(0).max(60000).optional(),

    // Mooncake (open-loop only).
    mooncakeTrace: z.enum(["conversation", "toolagent"]).optional(),
    islBlockSize: z.number().int().min(1).max(4096).optional(),
  })
  .superRefine((v, ctx) => {
    const isMooncake = v.dataset === "mooncake-trace";
    const hasConversation =
      v.conversationNum !== undefined ||
      v.conversationTurnMean !== undefined ||
      v.conversationTurnStddev !== undefined ||
      v.conversationType !== undefined ||
      v.conversationTurnDelayMeanMs !== undefined;

    if (isMooncake && hasConversation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "conversation params are closed-loop only; mooncake-trace replays open-loop (--fixed-schedule)",
        path: [],
      });
    }
    if (isMooncake && v.mooncakeTrace === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dataset=mooncake-trace requires mooncakeTrace (conversation | toolagent)",
        path: ["mooncakeTrace"],
      });
    }
    if (!isMooncake && (v.mooncakeTrace !== undefined || v.islBlockSize !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mooncakeTrace / islBlockSize are only valid when dataset=mooncake-trace",
        path: ["mooncakeTrace"],
      });
    }
  });

export type AiperfParams = z.infer<typeof aiperfParamsSchema>;

export const aiperfParamDefaults: Partial<AiperfParams> = {
  concurrency: 8,
  requestCount: 100,
  inputTokensMean: 1024,
  inputTokensStddev: 128,
  outputTokensMean: 256,
  outputTokensStddev: 64,
  endpointType: "chat",
  streaming: true,
  dataset: "synthetic",
};

const dist = z.object({
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
});

// Same general-perf-three-piece shape as evalscope (without prefixCacheStats).
// Both feed the same InferenceMetrics block in the web layer; the report
// data fields are deliberately convergent so the UI doesn't grow per-tool
// branches everywhere.
export const aiperfReportSchema = z.object({
  throughput: z.object({
    requestsPerSec: z.number().nonnegative(),
    outputTokensPerSec: z.number().nonnegative(),
    totalTokensPerSec: z.number().nonnegative(),
  }),
  ttft: dist,
  e2eLatency: dist,
  itl: dist,
  requests: z.object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
  }),
});

export type AiperfReport = z.infer<typeof aiperfReportSchema>;
