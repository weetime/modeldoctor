import { z } from "zod";

export const tau3DomainSchema = z.enum(["airline", "retail", "telecom"]);
export type Tau3Domain = z.infer<typeof tau3DomainSchema>;

export const tau3GateSchema = z
  .object({
    mode: z.enum(["off", "perDomainFloor", "baselineRegression"]).default("off"),
    perDomainFloor: z.record(tau3DomainSchema, z.number().min(0).max(1)).optional(),
    baselineRegressionPp: z.number().min(0).max(100).optional(),
  })
  .default({ mode: "off" });

export const tau3ParamsSchema = z.object({
  domains: z.array(tau3DomainSchema).min(1),
  numTasksPerDomain: z.number().int().positive().nullable(),
  numTrials: z.number().int().min(1).max(8),
  maxSteps: z.number().int().min(1).max(200).default(50),
  maxConcurrency: z.number().int().min(1).max(16).default(4),
  userSimProviderId: z.string().optional(),
  gate: tau3GateSchema,
});
export type Tau3Params = z.infer<typeof tau3ParamsSchema>;

export const tau3ParamDefaults: Tau3Params = {
  domains: ["airline", "retail", "telecom"],
  numTasksPerDomain: 20,
  numTrials: 3,
  maxSteps: 50,
  maxConcurrency: 4,
  gate: { mode: "off" },
};

const perDomainMetricsSchema = z.object({
  pass1: z.number(),
  passK: z.number(),
  tasks: z.number().int(),
  avgReward: z.number().optional(),
  infraErrors: z.number().int().optional(),
});
export const tau3ReportSchema = z.object({
  kind: z.literal("agent-tau3"),
  userSimModel: z.string(),
  numTrials: z.number().int(),
  /**
   * τ³-bench provenance: the upstream `results.info.git_commit` from the
   * first loaded domain's results.json, when available; otherwise a static
   * `"tau3-bench v1.0.0"` fallback. Rendered in AgentReport near the
   * user-simulator caveat so reports carry which upstream commit produced
   * them.
   */
  benchVersion: z.string().optional(),
  overall: perDomainMetricsSchema,
  perDomain: z.record(tau3DomainSchema, perDomainMetricsSchema),
  attribution: z.record(z.string(), z.number()),
  highlights: z.object({
    successSimId: z.string().nullable(),
    successDomain: z.string().nullable(),
    failureSimId: z.string().nullable(),
    failureDomain: z.string().nullable(),
  }),
  gate: z
    .object({
      mode: z.string(),
      result: z.enum(["PASSED", "WARNING", "FAILED"]).nullable(),
      detail: z.string().optional(),
    })
    .optional(),
});
export type Tau3Report = z.infer<typeof tau3ReportSchema>;
