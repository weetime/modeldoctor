import { ModalityCategorySchema, serverKindSchema } from "@modeldoctor/contracts";
import { z } from "zod";

const baseShape = {
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1)),
  apiBaseUrl: z.string().url(),
  model: z.string().default(""),
  customHeaders: z.string(),
  queryParams: z.string(),
  tokenizerHfId: z.string(),
  // Bind to a saved Prometheus datasource for AI alert explanation.
  // `undefined` lets the API auto-fill the org-default datasource on create;
  // `null` explicitly unbinds; a string id must reference an existing row.
  prometheusDatasourceId: z.string().nullable().optional(),
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

function requireModelEndpointFields<
  T extends { apiKey?: string; model?: string; category?: unknown },
>(v: T, ctx: z.RefinementCtx, opts: { apiKeyRequired: boolean }) {
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
 * Create-mode form schema. apiKey is required because the server has nothing
 * stored yet. Every Connection is a model endpoint after #220 — no more
 * kind-conditional carve-outs.
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
  .superRefine((v, ctx) => requireModelEndpointFields(v, ctx, { apiKeyRequired: true }));

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
  .superRefine((v, ctx) => requireModelEndpointFields(v, ctx, { apiKeyRequired: false }));

/** Backwards-compatible alias used by callers that need the create shape. */
export const connectionInputSchema = connectionInputCreateSchema;

export type ConnectionInput = z.infer<typeof connectionInputCreateSchema>;
