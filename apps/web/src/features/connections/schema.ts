import {
  ModalityCategorySchema,
  connectionKindSchema,
  serverKindSchema,
} from "@modeldoctor/contracts";
import { z } from "zod";

const baseShape = {
  kind: connectionKindSchema.default("model"),
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1)),
  apiBaseUrl: z.string().url(),
  // model/category/apiKey are required only for kind=model — see superRefine below.
  model: z.string().default(""),
  customHeaders: z.string(),
  queryParams: z.string(),
  tokenizerHfId: z.string(),
  prometheusUrl: z.string().url().nullable().optional(),
  serverKind: serverKindSchema.nullable().optional(),
  category: ModalityCategorySchema.nullable().optional(),
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

function requireForModelKind<
  T extends { kind?: string; apiKey?: string; model?: string; category?: unknown },
>(v: T, ctx: z.RefinementCtx, opts: { apiKeyRequired: boolean }) {
  if (v.kind !== "model") return;
  if (opts.apiKeyRequired && (!v.apiKey || v.apiKey.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "validation.required" });
  }
  if (!v.model || v.model.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "validation.required" });
  }
  if (!v.category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["category"],
      message: "validation.required",
    });
  }
}

/**
 * Create-mode form schema. apiKey is required for kind=model because the server
 * has nothing stored yet; non-model kinds skip the apiKey/model/category gate.
 */
export const connectionInputCreateSchema = z
  .object({
    ...baseShape,
    apiKey: z
      .string()
      .default("")
      .refine((v) => !/\p{Cc}/u.test(v), { message: "validation.apiKeyControlChar" })
      .refine((v) => v === v.trim(), { message: "validation.apiKeyTrim" }),
  })
  .superRefine((v, ctx) => requireForModelKind(v, ctx, { apiKeyRequired: true }));

/**
 * Edit-mode form schema. apiKey is optional: when the user did NOT toggle
 * "Reset apiKey", the field is empty and the PATCH body must omit it.
 */
export const connectionInputEditSchema = z
  .object({
    ...baseShape,
    apiKey: z
      .string()
      .default("")
      .refine((v) => v === "" || !/\p{Cc}/u.test(v), { message: "validation.apiKeyControlChar" })
      .refine((v) => v === "" || v === v.trim(), { message: "validation.apiKeyTrim" }),
  })
  .superRefine((v, ctx) => requireForModelKind(v, ctx, { apiKeyRequired: false }));

/** Backwards-compatible alias used by callers that need the create shape. */
export const connectionInputSchema = connectionInputCreateSchema;

export type ConnectionInput = z.infer<typeof connectionInputCreateSchema>;
