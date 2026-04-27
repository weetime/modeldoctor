import { z } from "zod";

/** @deprecated Phase-1 error shape. Kept for clients that haven't migrated yet. */
export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const StandardErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
export type StandardErrorResponse = z.infer<typeof StandardErrorResponseSchema>;

/** Stable error codes. Append-only — never change the string of an existing code. */
export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  // Phase 3 (benchmark)
  BENCHMARK_DATASET_UNSUPPORTED: "BENCHMARK_DATASET_UNSUPPORTED",
  BENCHMARK_NAME_IN_USE: "BENCHMARK_NAME_IN_USE",
  BENCHMARK_ALREADY_TERMINAL: "BENCHMARK_ALREADY_TERMINAL",
  BENCHMARK_NOT_TERMINAL: "BENCHMARK_NOT_TERMINAL",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
