import { ModalityCategorySchema, serverKindSchema } from "@modeldoctor/contracts";
import { z } from "zod";

const baseShape = {
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1)),
  apiBaseUrl: z.string().url(),
  model: z.string().min(1),
  customHeaders: z.string(),
  queryParams: z.string(),
  tokenizerHfId: z.string(),
  prometheusUrl: z.string().url().nullable().optional(),
  serverKind: serverKindSchema.nullable().optional(),
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
  apiKey: z
    .string()
    .min(1)
    .refine((v) => !/\p{Cc}/u.test(v), { message: "validation.apiKeyControlChar" })
    .refine((v) => v === v.trim(), { message: "validation.apiKeyTrim" }),
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
    .refine((v) => v === "" || !/\p{Cc}/u.test(v), { message: "validation.apiKeyControlChar" })
    .refine((v) => v === "" || v === v.trim(), { message: "validation.apiKeyTrim" }),
});

/** Backwards-compatible alias used by callers that need the create shape. */
export const connectionInputSchema = connectionInputCreateSchema;

export type ConnectionInput = z.infer<typeof connectionInputCreateSchema>;
