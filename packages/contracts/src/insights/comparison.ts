import { z } from "zod";

export const baselineCheckComparisonSchema = z.object({
  checkId: z.string(),
  currentP50: z.number(),
  historicalP50: z.number(),
  historicalP90: z.number(),
  deltaPct: z.number(),
  sampleSize: z.number().int(),
});
export type BaselineCheckComparison = z.infer<typeof baselineCheckComparisonSchema>;

export const baselineComparisonResponseSchema = z.object({
  items: z.array(baselineCheckComparisonSchema),
});

export const fleetCheckComparisonSchema = z.object({
  checkId: z.string(),
  currentP50: z.number(),
  fleetP50: z.number(),
  fleetP90: z.number(),
  sampleSize: z.number().int(),
});
export type FleetCheckComparison = z.infer<typeof fleetCheckComparisonSchema>;

export const fleetComparisonResponseSchema = z.object({
  items: z.array(fleetCheckComparisonSchema),
});
