import { ModalityCategorySchema } from "@modeldoctor/contracts";
import { z } from "zod";

const baseShape = {
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "required")),
  apiBaseUrl: z.string().url("invalid URL"),
  model: z.string().min(1, "required"),
  customHeaders: z.string(),
  queryParams: z.string(),
  tokenizerHfId: z.string(),
  category: ModalityCategorySchema,
  tags: z
    .array(z.string().trim())
    .default([])
    .transform((arr) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of arr) {
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    }),
};

/**
 * Create-mode form schema. apiKey is required because the server has nothing
 * stored yet.
 */
export const connectionInputCreateSchema = z.object({
  ...baseShape,
  // Reject control chars + leading/trailing whitespace at form level
  // for parity with server-side contract (prevents accidental paste
  // of token with trailing newline).
  apiKey: z
    .string()
    .min(1, "required")
    .refine((v) => !/\p{Cc}/u.test(v), {
      message: "apiKey must not contain control characters",
    })
    .refine((v) => v === v.trim(), {
      message: "apiKey must not have leading or trailing whitespace",
    }),
});

/**
 * Edit-mode form schema. apiKey is optional: when the user did NOT toggle
 * "Reset apiKey", the field is empty and the PATCH body must omit it.
 * Empty string is the "no-reset" signal and must pass; non-empty values
 * get the same control-char + edge-whitespace refines as create-mode.
 */
export const connectionInputEditSchema = z.object({
  ...baseShape,
  apiKey: z
    .string()
    .refine((v) => v === "" || !/\p{Cc}/u.test(v), {
      message: "apiKey must not contain control characters",
    })
    .refine((v) => v === "" || v === v.trim(), {
      message: "apiKey must not have leading or trailing whitespace",
    }),
});

/** Backwards-compatible alias used by callers that need the create shape. */
export const connectionInputSchema = connectionInputCreateSchema;

export type ConnectionInput = z.infer<typeof connectionInputCreateSchema>;
