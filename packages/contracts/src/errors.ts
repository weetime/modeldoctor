import { z } from "zod";

/** Legacy-compatible error shape. Every non-2xx response from apps/api matches this. */
export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
