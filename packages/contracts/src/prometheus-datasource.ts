import { z } from "zod";

const bearerTokenSchema = z
  .string()
  .refine((v) => !/\p{Cc}/u.test(v), {
    message: "bearerToken must not contain control characters",
  })
  .refine((v) => v === v.trim(), {
    message: "bearerToken must not have leading or trailing whitespace",
  });

export const prometheusDatasourcePublicSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  bearerPreview: z.string(),
  customHeaders: z.string(),
  isDefault: z.boolean(),
  consumersCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PrometheusDatasourcePublic = z.infer<typeof prometheusDatasourcePublicSchema>;

export const prometheusDatasourceWithSecretSchema = prometheusDatasourcePublicSchema.extend({
  bearerToken: z.string(),
});
export type PrometheusDatasourceWithSecret = z.infer<typeof prometheusDatasourceWithSecretSchema>;

export const createPrometheusDatasourceSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  bearerToken: bearerTokenSchema.optional(),
  customHeaders: z.string().default(""),
  isDefault: z.boolean().default(false),
});
export type CreatePrometheusDatasource = z.infer<typeof createPrometheusDatasourceSchema>;

export const updatePrometheusDatasourceSchema = createPrometheusDatasourceSchema.partial();
export type UpdatePrometheusDatasource = z.infer<typeof updatePrometheusDatasourceSchema>;

export const listPrometheusDatasourcesResponseSchema = z.object({
  items: z.array(prometheusDatasourcePublicSchema),
});
export type ListPrometheusDatasourcesResponse = z.infer<
  typeof listPrometheusDatasourcesResponseSchema
>;

export const verifyPrometheusDatasourceRequestSchema = z.object({
  baseUrl: z.string().url(),
  bearerToken: z.string().optional(),
  customHeaders: z.string().optional(),
});
export type VerifyPrometheusDatasourceRequest = z.infer<
  typeof verifyPrometheusDatasourceRequestSchema
>;

export const verifyPrometheusDatasourceResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  reason: z.string().optional(),
});
export type VerifyPrometheusDatasourceResponse = z.infer<
  typeof verifyPrometheusDatasourceResponseSchema
>;

/** Delete response — gives the consumer count detached so the UI can toast. */
export const deletePrometheusDatasourceResponseSchema = z.object({
  consumersDetached: z.number().int().min(0),
});
export type DeletePrometheusDatasourceResponse = z.infer<
  typeof deletePrometheusDatasourceResponseSchema
>;
