import { z } from "zod";

export const ProbeNameSchema = z.enum(["text", "image", "audio"]);
export type ProbeName = z.infer<typeof ProbeNameSchema>;

export const ProbeCheckSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  info: z.string().optional(),
});
export type ProbeCheck = z.infer<typeof ProbeCheckSchema>;

export const ProbeResultSchema = z.object({
  pass: z.boolean(),
  latencyMs: z.number().nullable(),
  checks: z.array(ProbeCheckSchema),
  details: z.object({
    content: z.string().optional(),
    usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
    imagePreviewB64: z.string().optional(),
    imageMime: z.string().optional(),
    audioB64: z.string().optional(),
    audioBytes: z.number().optional(),
    numChoices: z.number().optional(),
    textReply: z.string().optional(),
    error: z.string().optional(),
  }),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

// Convention: `apiBaseUrl` is the origin (scheme://host[:port][/proxy-prefix]),
// without `/v1/...` path tail. Each probe constructs its target URL by
// appending its OpenAI-compatible path.
export const E2ETestRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  probes: z.array(ProbeNameSchema).min(1),
});
export type E2ETestRequest = z.infer<typeof E2ETestRequestSchema>;

export const E2ETestResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(ProbeResultSchema.extend({ probe: ProbeNameSchema })),
  error: z.string().optional(),
});
export type E2ETestResponse = z.infer<typeof E2ETestResponseSchema>;
