import { z } from "zod";

const exactMatch = z.object({
  kind: z.literal("exact-match"),
  caseSensitive: z.boolean().optional(),
  trim: z.boolean().optional(),
});

const contains = z.object({
  kind: z.literal("contains"),
  substrings: z.array(z.string().min(1)).min(1).max(50),
  mode: z.enum(["all", "any"]).default("all"),
  caseSensitive: z.boolean().optional(),
});

const regex = z.object({
  kind: z.literal("regex"),
  pattern: z.string().min(1),
  flags: z.string().optional(),
});

const llmJudge = z.object({
  kind: z.literal("llm-judge"),
  rubric: z.string().min(10).max(4000),
  scale: z.enum(["0-1", "0-5", "pass-fail"]),
  passThreshold: z.number().optional(),
  judgeModel: z.object({ connectionId: z.string() }).optional(),
});

const baseUnion = z.discriminatedUnion("kind", [exactMatch, contains, regex, llmJudge]);

export const judgeConfigSchema = baseUnion.superRefine((cfg, ctx) => {
  if (cfg.kind === "regex") {
    try {
      new RegExp(cfg.pattern, cfg.flags);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pattern"],
        message: `invalid regex: ${(e as Error).message}`,
      });
    }
  }
  if (cfg.kind === "llm-judge" && cfg.passThreshold != null) {
    const bounds: Record<string, [number, number]> = { "0-1": [0, 1], "0-5": [0, 5], "pass-fail": [0, 1] };
    const [lo, hi] = bounds[cfg.scale];
    if (cfg.passThreshold < lo || cfg.passThreshold > hi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passThreshold"],
        message: `passThreshold ${cfg.passThreshold} outside scale ${cfg.scale} bounds [${lo}, ${hi}]`,
      });
    }
  }
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;

export function defaultPassThreshold(scale: Extract<JudgeConfig, { kind: "llm-judge" }>["scale"]): number {
  return scale === "0-1" ? 0.5 : scale === "0-5" ? 3 : 0.5;
}
