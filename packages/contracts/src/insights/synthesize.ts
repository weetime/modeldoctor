import { z } from "zod";

export const narrativeFindingSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  title: z.string(),
  rootCause: z.string(),
  recommendations: z.array(z.string()),
});
export type NarrativeFinding = z.infer<typeof narrativeFindingSchema>;

export const synthesizeRequestSchema = z.object({
  profileSlug: z.string(),
  range: z.enum(["7d", "30d", "90d"]),
  runIds: z.array(z.string()).max(500),
  // Output language. Defaults to zh-CN for backwards compat.
  locale: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
});
export type SynthesizeRequest = z.infer<typeof synthesizeRequestSchema>;

export const synthesizeResponseSchema = z.object({
  findings: z.array(narrativeFindingSchema),
  generatedAt: z.string().datetime(),
  runIdsHash: z.string(),
  fromCache: z.boolean(),
});
export type SynthesizeResponse = z.infer<typeof synthesizeResponseSchema>;
