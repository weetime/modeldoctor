import { z } from "zod";

export const connectionApiTypeSchema = z.enum([
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
]);
export type ConnectionApiType = z.infer<typeof connectionApiTypeSchema>;

export const serverKindSchema = z.enum(["vllm", "sglang", "tgi", "higress", "generic"]);
export type ServerKind = z.infer<typeof serverKindSchema>;

export const connectionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiType: connectionApiTypeSchema,
  prometheusUrl: z.string().url().nullable(),
  serverKind: serverKindSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const createConnectionSchema = connectionSchema
  .pick({
    name: true,
    baseUrl: true,
    apiType: true,
    prometheusUrl: true,
    serverKind: true,
  })
  .extend({
    prometheusUrl: z.string().url().nullable().optional(),
    serverKind: serverKindSchema.nullable().optional(),
  });
export type CreateConnection = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = createConnectionSchema.partial();
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;

export const listConnectionsResponseSchema = z.object({
  items: z.array(connectionSchema),
});
export type ListConnectionsResponse = z.infer<typeof listConnectionsResponseSchema>;
