import { z } from "zod";
import { scenarioIdSchema } from "../benchmark.js";

export const radarAxisIdSchema = z.enum([
  "responsiveness",
  "smoothness",
  "throughput",
  "stability",
  "tail",
  "efficiency",
]);
export type RadarAxisId = z.infer<typeof radarAxisIdSchema>;

export const severitySchema = z.enum(["good", "warn", "crit", "no_data"]);
export type Severity = z.infer<typeof severitySchema>;

export const findingSchema = z.object({
  checkId: z.string(),
  scenario: scenarioIdSchema,
  axis: radarAxisIdSchema,
  severity: severitySchema,
  value: z.number().nullable(),
  threshold: z.object({ warn: z.number(), crit: z.number() }),
  weight: z.number(),
  recommendation: z.string(),
  contributingRunIds: z.array(z.string()),
});
export type Finding = z.infer<typeof findingSchema>;

// Note: CheckDescriptor itself is NOT a contract — it's a frontend-only
// pure-function bundle. Only the Finding output and the ProfileRules input
// cross the API boundary.
