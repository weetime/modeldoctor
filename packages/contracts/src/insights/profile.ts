import { z } from "zod";

export const profileRuleSchema = z.object({
  warn: z.number(),
  crit: z.number(),
  weight: z.number().optional(),
});
export type ProfileRule = z.infer<typeof profileRuleSchema>;

export const profileRulesSchema = z.object({
  checks: z.record(profileRuleSchema),
  axisWeights: z.record(z.number()).optional(),
});
export type ProfileRules = z.infer<typeof profileRulesSchema>;

export const evaluationProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  nameKey: z.string().nullable(),
  description: z.string().nullable(),
  isBuiltin: z.boolean(),
  rules: profileRulesSchema,
  source: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>;

export const listEvaluationProfilesResponseSchema = z.object({
  items: z.array(evaluationProfileSchema),
});
export type ListEvaluationProfilesResponse = z.infer<typeof listEvaluationProfilesResponseSchema>;
