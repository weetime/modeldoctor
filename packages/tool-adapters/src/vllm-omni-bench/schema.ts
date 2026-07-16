import { z } from "zod";

// vLLM-Omni 官方 bench (`vllm-omni bench serve --omni`) 是目前唯一产出
// AUDIO_TTFP / AUDIO_RTF 百分位的开源压测客户端。本 adapter 不直接拼 bench
// argv —— buildCommand 启动 runner 内的 omni_driver(python),由它循环
// 双臂 × 并发档 逐点调 bench 并聚合(spec §3/§4.2)。
export const vllmOmniBenchParamsSchema = z
  .object({
    // 并发档列表;一个 run 内逐档扫描。上限 10 档防止 run 时长失控。
    concurrencyLevels: z
      .array(z.number().int().min(1).max(512))
      .min(1)
      .max(10)
      .default([1, 8, 16, 32]),
    inputTokens: z.number().int().min(1).max(32000).default(500),
    // 双臂共用(= max_tokens);RTF 与音频时长强相关,双臂必须同长。
    outputTokens: z.number().int().min(1).max(4096).default(300),
    // true = 追加 text-only 对照臂,同档同参,产出语音税(ΔE2EL)。
    voiceTax: z.boolean().default(true),
    numWarmups: z.number().int().min(0).max(10).default(1),
    // 单点 bench 子进程超时;超时记 failed 点,继续后续点。
    perPointTimeoutSeconds: z.number().int().min(60).max(3600).default(900),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.concurrencyLevels).size !== v.concurrencyLevels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["concurrencyLevels"],
        message: "concurrencyLevels must not contain duplicates",
      });
    }
  });

export type VllmOmniBenchParams = z.infer<typeof vllmOmniBenchParamsSchema>;

export const vllmOmniBenchParamDefaults: Partial<VllmOmniBenchParams> = {
  concurrencyLevels: [1, 8, 16, 32],
  inputTokens: 500,
  outputTokens: 300,
  voiceTax: true,
  numWarmups: 1,
  perPointTimeoutSeconds: 900,
};

// bench 汇总只出 Mean/Median/P99(--percentile-metrics 默认分位),
// 故 stat 三件套,不套用 inference 的 5 桶 dist。
const stat = z.object({ mean: z.number(), p50: z.number(), p99: z.number() });

const curvePointSchema = z.object({
  arm: z.enum(["audio", "text"]),
  concurrency: z.number().int().positive(),
  status: z.enum(["ok", "failed"]),
  reqPerSec: z.number().nonnegative().nullable(),
  outTokPerSec: z.number().nonnegative().nullable(),
  ttftMs: stat.nullable(),
  e2elMs: stat.nullable(),
  // text 臂 / failed 点为 null。
  audioTtfpMs: stat.nullable(),
  audioRtf: stat.nullable(),
});

export const vllmOmniBenchReportSchema = z.object({
  curve: z.array(curvePointSchema).min(1),
  derived: z.object({
    // audio 臂 RTF(mean)<1 的最大档;全部 ≥1 则 0。
    realtimeCeiling: z.number().int().nonnegative(),
    peakConcurrency: z.number().int().nonnegative(),
    voiceTaxMsByLevel: z.record(z.number()),
    voiceTaxMs: z.number().nullable(),
  }),
  warnings: z.array(z.string()),
});

export type VllmOmniBenchReport = z.infer<typeof vllmOmniBenchReportSchema>;
