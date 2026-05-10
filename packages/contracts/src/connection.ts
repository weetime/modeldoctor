import { z } from "zod";
import { ENGINE_IDS } from "./engine.js";
import { ModalityCategorySchema } from "./modality.js";

export const serverKindSchema = z.enum([...ENGINE_IDS, "higress", "generic"] as const);
export type ServerKind = z.infer<typeof serverKindSchema>;

/** What clients see on list / detail. No plaintext apiKey, only preview. */
export const connectionPublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKeyPreview: z.string(),
  model: z.string().min(1),
  customHeaders: z.string(),
  queryParams: z.string(),
  category: ModalityCategorySchema,
  tags: z.array(z.string()),
  prometheusUrl: z.string().url().nullable(),
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

export const createConnectionSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z
    .string()
    .min(1)
    .refine((v) => !/\p{Cc}/u.test(v), {
      message: "apiKey must not contain control characters",
    })
    .refine((v) => v === v.trim(), {
      message: "apiKey must not have leading or trailing whitespace",
    }),
  model: z.string().min(1),
  customHeaders: z.string().default(""),
  queryParams: z.string().default(""),
  category: ModalityCategorySchema,
  tags: z.array(z.string()).default([]),
  prometheusUrl: z.string().url().nullable().optional(),
  serverKind: serverKindSchema.nullable().optional(),
  tokenizerHfId: z.string().nullable().optional(),
  evaluationProfileId: z.string().nullable().optional(),
});
export type CreateConnection = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = createConnectionSchema.partial();
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

export const discoverConnectionRequestSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
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
