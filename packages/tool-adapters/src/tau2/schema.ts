import { z } from "zod";

export const tau2DomainSchema = z.enum(["airline", "retail", "telecom"]);
export type Tau2Domain = z.infer<typeof tau2DomainSchema>;

export const tau2GateSchema = z.object({
  mode: z.enum(["off", "perDomainFloor", "baselineRegression"]).default("off"),
  perDomainFloor: z.record(tau2DomainSchema, z.number().min(0).max(1)).optional(),
  baselineRegressionPp: z.number().min(0).max(100).optional(),
}).default({ mode: "off" });

export const tau2ParamsSchema = z.object({
  domains: z.array(tau2DomainSchema).min(1),
  numTasksPerDomain: z.number().int().positive().nullable(),
  numTrials: z.number().int().min(1).max(8),
  maxSteps: z.number().int().min(1).max(200).default(50),
  maxConcurrency: z.number().int().min(1).max(16).default(4),
  userSimProviderId: z.string().optional(),
  gate: tau2GateSchema,
});
export type Tau2Params = z.infer<typeof tau2ParamsSchema>;

export const tau2ParamDefaults: Tau2Params = {
  domains: ["airline", "retail", "telecom"],
  numTasksPerDomain: 20, numTrials: 3, maxSteps: 50, maxConcurrency: 4,
  gate: { mode: "off" },
};

const perDomainMetricsSchema = z.object({
  pass1: z.number(), passK: z.number(), tasks: z.number().int(),
  avgReward: z.number().optional(), infraErrors: z.number().int().optional(),
});
export const tau2ReportSchema = z.object({
  kind: z.literal("agent-tau2"),
  userSimModel: z.string(),
  numTrials: z.number().int(),
  overall: perDomainMetricsSchema,
  perDomain: z.record(tau2DomainSchema, perDomainMetricsSchema),
  attribution: z.record(z.string(), z.number()),
  highlights: z.object({
    successSimId: z.string().nullable(), successDomain: z.string().nullable(),
    failureSimId: z.string().nullable(), failureDomain: z.string().nullable(),
  }),
  gate: z.object({
    mode: z.string(),
    result: z.enum(["PASSED", "WARNING", "FAILED"]).nullable(),
    detail: z.string().optional(),
  }).optional(),
});
export type Tau2Report = z.infer<typeof tau2ReportSchema>;
