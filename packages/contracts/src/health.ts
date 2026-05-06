import { z } from "zod";

// Terminus HealthCheckResult: { status, info?, error?, details }.
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "error", "shutting_down"]),
  info: z.record(z.object({ status: z.string() })).optional(),
  error: z.record(z.object({ status: z.string(), message: z.string().optional() })).optional(),
  details: z.record(z.object({ status: z.string() })).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
