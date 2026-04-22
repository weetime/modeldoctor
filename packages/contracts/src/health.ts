import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const CheckVegetaResponseSchema = z.object({
  installed: z.boolean(),
  message: z.string(),
  path: z.string().nullable(),
});
export type CheckVegetaResponse = z.infer<typeof CheckVegetaResponseSchema>;
