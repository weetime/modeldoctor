import { z } from "zod";

/** Summary embedded into RunDto.baselineFor — minimum needed by detail page. */
export const baselineSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime(),
});
export type BaselineSummary = z.infer<typeof baselineSummarySchema>;

/** Full row over the wire. Mirrors prisma `Baseline` columns. */
export const baselineSchema = z.object({
  id: z.string(),
  userId: z.string(),
  runId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  templateId: z.string().nullable(),
  templateVersion: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Baseline = z.infer<typeof baselineSchema>;

/** POST /baselines payload. Server fills userId / templateId / templateVersion / active. */
export const createBaselineSchema = z.object({
  runId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type CreateBaseline = z.infer<typeof createBaselineSchema>;

export const listBaselinesResponseSchema = z.object({
  items: z.array(baselineSchema),
});
export type ListBaselinesResponse = z.infer<typeof listBaselinesResponseSchema>;
