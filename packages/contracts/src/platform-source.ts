import { z } from "zod";
import { gateConfigSchema } from "./quality-gate/runs.js";

export const platformSourceKindSchema = z.enum(["gpustack"]);
export type PlatformSourceKind = z.infer<typeof platformSourceKindSchema>;

const baseUrlSchema = z
  .string()
  .url()
  .transform((u) => u.replace(/\/+$/, ""));

export const createPlatformSourceSchema = z.object({
  kind: platformSourceKindSchema.default("gpustack"),
  name: z.string().min(1).max(120),
  baseUrl: baseUrlSchema,
  apiKey: z.string().min(1),
  clusterId: z.string().min(1).nullable().optional(),
});
export type CreatePlatformSource = z.infer<typeof createPlatformSourceSchema>;

export const updatePlatformSourceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  baseUrl: baseUrlSchema.optional(),
  apiKey: z.string().min(1).optional(),
  clusterId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdatePlatformSource = z.infer<typeof updatePlatformSourceSchema>;

export const platformSourceSchema = z.object({
  id: z.string(),
  kind: platformSourceKindSchema,
  name: z.string(),
  baseUrl: z.string(),
  clusterId: z.string().nullable(),
  enabled: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastSyncError: z.string().nullable(),
  modelCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlatformSource = z.infer<typeof platformSourceSchema>;

export const testPlatformSourceResponseSchema = z.object({
  ok: z.boolean(),
  modelCount: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type TestPlatformSourceResponse = z.infer<typeof testPlatformSourceResponseSchema>;

export const discoveredModelStatusSchema = z.enum(["new", "active", "unroutable", "removed"]);
export type DiscoveredModelStatus = z.infer<typeof discoveredModelStatusSchema>;

export const AUTOMATION_STEPS = ["diagnostics", "quality_gate", "benchmark"] as const;
export const automationStepSchema = z.enum(AUTOMATION_STEPS);
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationScheduleSchema = z.enum(["off", "daily", "weekly"]);
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;

export const regressionThresholdsSchema = z.object({
  outputTokensPerSecDropPct: z.number().min(0).max(100),
  ttftP95RisePct: z.number().min(0).max(1000),
  itlP95RisePct: z.number().min(0).max(1000),
});
export type RegressionThresholds = z.infer<typeof regressionThresholdsSchema>;

export const DEFAULT_REGRESSION_THRESHOLDS: RegressionThresholds = {
  outputTokensPerSecDropPct: 10,
  ttftP95RisePct: 15,
  itlP95RisePct: 15,
};

export const DEFAULT_GATE_CONFIG = { passRateMin: 0.9 } as const;

export const automationTriggerSchema = z.enum(["enable", "revision", "schedule", "manual"]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const automationRunStatusSchema = z.enum(["pending", "running", "completed", "cancelled"]);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

export const automationVerdictSchema = z.enum([
  "passed",
  "failed",
  "regressed",
  "error",
  "superseded",
]);
export type AutomationVerdict = z.infer<typeof automationVerdictSchema>;

export const regressionMetricSchema = z.object({
  metric: z.enum(["outputTokensPerSec", "ttft.p95", "itl.p95"]),
  baseline: z.number().nullable(),
  current: z.number().nullable(),
  changePct: z.number().nullable(),
  thresholdPct: z.number(),
  exceeded: z.boolean(),
});
export type RegressionMetric = z.infer<typeof regressionMetricSchema>;

export const automationSummarySchema = z.object({
  steps: z.array(
    z.object({
      step: z.union([automationStepSchema, z.literal("compare")]),
      outcome: z.enum(["ok", "failed", "error", "skipped"]),
      message: z.string().optional(),
    }),
  ),
  regression: z
    .object({
      compared: z.boolean(),
      reason: z.string().optional(),
      baselineId: z.string().optional(),
      metrics: z.array(regressionMetricSchema),
    })
    .optional(),
  baselineEstablished: z.boolean().optional(),
  gateWarning: z.boolean().optional(),
});
export type AutomationSummary = z.infer<typeof automationSummarySchema>;

export const automationRunSchema = z.object({
  id: z.string(),
  discoveredModelId: z.string(),
  revisionId: z.string(),
  trigger: automationTriggerSchema,
  status: automationRunStatusSchema,
  currentStep: z.string().nullable(),
  verdict: automationVerdictSchema.nullable(),
  diagnosticsRunId: z.string().nullable(),
  evaluationRunId: z.string().nullable(),
  benchmarkId: z.string().nullable(),
  summary: automationSummarySchema.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AutomationRunPublic = z.infer<typeof automationRunSchema>;

export const discoveredModelSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  externalId: z.string(),
  name: z.string(),
  categories: z.array(z.string()),
  clusterId: z.string().nullable(),
  status: discoveredModelStatusSchema,
  routeName: z.string().nullable(),
  routeOverride: z.boolean(),
  connectionId: z.string().nullable(),
  currentRevision: z
    .object({
      id: z.string(),
      fingerprint: z.string(),
      backend: z.string().nullable(),
      backendVersion: z.string().nullable(),
      readyAt: z.string().nullable(),
    })
    .nullable(),
  automationEnabled: z.boolean(),
  steps: z.array(automationStepSchema),
  evaluationId: z.string().nullable(),
  gateConfig: gateConfigSchema.nullable(),
  benchmarkTemplateId: z.string().nullable(),
  schedule: automationScheduleSchema,
  nextScheduledAt: z.string().nullable(),
  baselineId: z.string().nullable(),
  regressionThresholds: regressionThresholdsSchema.nullable(),
  lastRun: automationRunSchema.nullable(),
});
export type DiscoveredModelPublic = z.infer<typeof discoveredModelSchema>;

export const updateDiscoveredModelSchema = z.object({
  automationEnabled: z.boolean().optional(),
  steps: z.array(automationStepSchema).min(1).optional(),
  evaluationId: z.string().min(1).nullable().optional(),
  gateConfig: gateConfigSchema.nullable().optional(),
  benchmarkTemplateId: z.string().min(1).nullable().optional(),
  schedule: automationScheduleSchema.optional(),
  baselineId: z.string().min(1).nullable().optional(),
  regressionThresholds: regressionThresholdsSchema.nullable().optional(),
  /** 手动指定 GPUStack 路由名（置 routeOverride=true）；null = 恢复自动解析 */
  routeName: z.string().min(1).nullable().optional(),
});
export type UpdateDiscoveredModel = z.infer<typeof updateDiscoveredModelSchema>;

export const listDiscoveredModelsQuerySchema = z.object({
  sourceId: z.string().optional(),
  status: discoveredModelStatusSchema.optional(),
  automationEnabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type ListDiscoveredModelsQuery = z.infer<typeof listDiscoveredModelsQuerySchema>;

export const snapshotDiffEntrySchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type SnapshotDiffEntry = z.infer<typeof snapshotDiffEntrySchema>;

export const deploymentRevisionSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  snapshot: z.record(z.unknown()),
  firstSeenAt: z.string(),
  readyAt: z.string().nullable(),
  diff: z.array(snapshotDiffEntrySchema),
  runs: z.array(automationRunSchema),
});
export type DeploymentRevisionPublic = z.infer<typeof deploymentRevisionSchema>;

export const gpustackRouteOptionSchema = z.object({
  name: z.string(),
  targets: z.number().int(),
  createdModelId: z.string().nullable(),
});
export type GpustackRouteOption = z.infer<typeof gpustackRouteOptionSchema>;
