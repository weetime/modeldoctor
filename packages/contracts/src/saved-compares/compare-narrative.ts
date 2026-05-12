import { z } from "zod";

export const compareNarrativeSchema = z.object({
  tldr: z
    .array(z.object({ headline: z.string().min(1), oneLine: z.string().min(1) }))
    .min(1)
    .max(8),
  analysis: z
    .array(z.object({ metricLabel: z.string().min(1), body: z.string().min(1) }))
    .min(0)
    .max(20),
  conclusion: z.object({
    recommendation: z.string().min(1),
    caveats: z.array(z.string()).min(0).max(10),
  }),
});
export type CompareNarrative = z.infer<typeof compareNarrativeSchema>;

export const compareSynthesizeRequestSchema = z.object({
  locale: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
});
export type CompareSynthesizeRequest = z.infer<typeof compareSynthesizeRequestSchema>;

export const compareSynthesizeResponseSchema = z.object({
  narrative: compareNarrativeSchema,
  generatedAt: z.string().datetime(),
  fromCache: z.boolean(),
});
export type CompareSynthesizeResponse = z.infer<typeof compareSynthesizeResponseSchema>;
