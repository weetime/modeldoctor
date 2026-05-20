import { z } from "zod";
import { ENGINE_IDS } from "./engine.js";
import { ModalityCategorySchema } from "./modality.js";

export const serverKindSchema = z.enum([...ENGINE_IDS, "higress", "generic"] as const);
export type ServerKind = z.infer<typeof serverKindSchema>;

/**
 * A Connection's `kind` records what kind of LLM-stack component it points at.
 *
 * - `model`   — model-serving endpoint (the original v1 meaning). Required:
 *               model, apiKey, category.
 * - `gateway` — LLM gateway in front of one or more model servers
 *               (e.g. Higress). apiKey/model/category remain meaningful when
 *               routing through the gateway. `serverKind=higress` is the
 *               canonical first instance.
 *
 * Note: Prometheus instances are no longer modeled as connections; they live
 * in their own first-class `PrometheusDatasource` table and are referenced
 * from a connection via `prometheusDatasourceId`. Alertmanager instances are
 * not modeled at all — they push alerts via webhook and we attribute each
 * incoming alert to a `kind=model` Connection by label match (see
 * AlertsService#inferConnection).
 */
export const connectionKindSchema = z.enum(["model", "gateway"]);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

/** What clients see on list / detail. No plaintext apiKey, only preview. */
export const connectionPublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: connectionKindSchema,
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKeyPreview: z.string(),
  model: z.string(),
  customHeaders: z.string(),
  queryParams: z.string(),
  category: ModalityCategorySchema.nullable(),
  tags: z.array(z.string()),
  prometheusDatasourceId: z.string().nullable(),
  prometheusDatasource: z
    .object({
      id: z.string(),
      name: z.string(),
      baseUrl: z.string().url(),
    })
    .nullable(),
  serverKind: serverKindSchema.nullable(),
  tokenizerHfId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  evaluationProfileId: z.string().nullable(),
  evaluationProfile: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      nameKey: z.string().nullable(),
    })
    .nullable(),
});
export type ConnectionPublic = z.infer<typeof connectionPublicSchema>;

/** Returned exactly once by POST /api/connections, and by PATCH when apiKey is rotated. */
export const connectionWithSecretSchema = connectionPublicSchema.extend({
  apiKey: z.string(),
});
export type ConnectionWithSecret = z.infer<typeof connectionWithSecretSchema>;

// apiKey shape validation lives here so create + update share it. Required-ness
// is enforced separately via .superRefine() because non-model kinds skip it.
const apiKeyStringSchema = z
  .string()
  .refine((v) => !/\p{Cc}/u.test(v), {
    message: "apiKey must not contain control characters",
  })
  .refine((v) => v === v.trim(), {
    message: "apiKey must not have leading or trailing whitespace",
  });

const createConnectionShape = z.object({
  kind: connectionKindSchema.default("model"),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  // Optional at the schema level so non-model kinds can omit. Required-ness for
  // kind=model is enforced via superRefine below.
  apiKey: apiKeyStringSchema.optional(),
  model: z.string().optional(),
  customHeaders: z.string().default(""),
  queryParams: z.string().default(""),
  category: ModalityCategorySchema.nullable().optional(),
  tags: z.array(z.string()).default([]),
  // Three-state binding: undefined → server fills with default datasource;
  // null → explicit unbind; string → must reference an existing datasource.
  prometheusDatasourceId: z.string().nullish(),
  serverKind: serverKindSchema.nullable().optional(),
  tokenizerHfId: z.string().nullable().optional(),
  evaluationProfileId: z.string().nullable().optional(),
});

// kind=model retains the v1 contract: apiKey/model/category are required.
// kind=gateway has a looser shape since the entity being pointed at is not a
// model-serving endpoint.
function refineKindFields(v: z.infer<typeof createConnectionShape>, ctx: z.RefinementCtx) {
  if (v.kind === "model") {
    if (!v.apiKey || v.apiKey.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: "apiKey is required for kind=model",
      });
    }
    if (!v.model || v.model.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "model is required for kind=model",
      });
    }
    if (!v.category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "category is required for kind=model",
      });
    }
  }
}

export const createConnectionSchema = createConnectionShape.superRefine(refineKindFields);
export type CreateConnection = z.infer<typeof createConnectionSchema>;

// Update accepts a partial create shape; the same refine still applies when
// `kind` is being changed (or implicitly model when omitted on partial — but
// partial means kind may be absent; refine only fires when kind is supplied).
export const updateConnectionSchema = createConnectionShape.partial().superRefine((v, ctx) => {
  if (v.kind === "model") refineKindFields(v as z.infer<typeof createConnectionShape>, ctx);
});
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;

export const listConnectionsResponseSchema = z.object({
  items: z.array(connectionPublicSchema),
});
export type ListConnectionsResponse = z.infer<typeof listConnectionsResponseSchema>;

/** Owner-only response from GET /api/connections/:id/reveal-key. */
export const connectionRevealKeyResponseSchema = z.object({
  apiKey: z.string().min(1),
});
export type ConnectionRevealKeyResponse = z.infer<typeof connectionRevealKeyResponseSchema>;

export const inferenceConfidenceSchema = z.enum(["certain", "likely", "guess", "unknown"]);
export type InferenceConfidence = z.infer<typeof inferenceConfidenceSchema>;

const inferredFieldSchema = <V extends z.ZodTypeAny>(value: V) =>
  z.object({
    value: value.nullable(),
    confidence: inferenceConfidenceSchema,
    evidence: z.string(),
  });

const inferredListFieldSchema = z.object({
  values: z.array(z.string()),
  confidence: inferenceConfidenceSchema,
  evidence: z.string(),
});

export const verifyKindRequestSchema = z.object({
  kind: connectionKindSchema,
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
  customHeaders: z.string().optional(),
});
export type VerifyKindRequest = z.infer<typeof verifyKindRequestSchema>;

export const verifyKindResponseSchema = z.object({
  kind: connectionKindSchema,
  ok: z.boolean(),
  version: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
});
export type VerifyKindResponse = z.infer<typeof verifyKindResponseSchema>;

export const discoverConnectionRequestSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
  /**
   * Newline-separated `key: value` headers, propagated to every probe request.
   * Required for gateways that route by custom header (Higress's
   * `x-higress-llm-model`, internal proxies that need a project ID, etc.).
   * Same string format as `ConnectionInput.customHeaders` so the form can
   * round-trip the existing field into Discover unchanged.
   */
  customHeaders: z.string().optional(),
});
export type DiscoverConnectionRequest = z.infer<typeof discoverConnectionRequestSchema>;

export const discoverConnectionResponseSchema = z.object({
  health: z.object({
    durationMs: z.number().int().min(0),
    probesAttempted: z.number().int().min(0),
    probesFailed: z.array(z.object({ probe: z.string(), reason: z.string() })),
    warnings: z.array(z.string()),
  }),
  inferred: z.object({
    serverKind: inferredFieldSchema(serverKindSchema),
    models: inferredListFieldSchema,
    category: inferredFieldSchema(ModalityCategorySchema),
    suggestedTags: inferredListFieldSchema,
    prometheusUrl: inferredFieldSchema(z.string().url()),
  }),
});
export type DiscoverConnectionResponse = z.infer<typeof discoverConnectionResponseSchema>;
