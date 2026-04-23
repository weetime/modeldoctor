import { z } from "zod";

export const DebugProxyRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]).default("GET"),
  url: z.string().min(1, "url is required"),
  headers: z.record(z.string()).default({}),
  body: z.union([z.string(), z.null()]).optional(),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
});
export type DebugProxyRequest = z.infer<typeof DebugProxyRequestSchema>;

export const DebugProxyResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    status: z.number().int(),
    statusText: z.string(),
    headers: z.record(z.string()),
    body: z.string(),
    bodyEncoding: z.enum(["text", "base64"]),
    timingMs: z.object({ ttfbMs: z.number(), totalMs: z.number() }),
    sizeBytes: z.number().int().nonnegative(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);
export type DebugProxyResponse = z.infer<typeof DebugProxyResponseSchema>;
