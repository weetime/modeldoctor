import type { ToolAdapter } from "../core/interface.js";
import { aiperfReadMetric } from "./read-metric.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { aiperfParamDefaults, aiperfParamsSchema, aiperfReportSchema } from "./schema.js";

export { aiperfReadMetric } from "./read-metric.js";

export const aiperfAdapter: ToolAdapter = {
  name: "aiperf",
  scenarios: ["inference", "lb-strategy", "engine-kv-cache"] as const,
  paramsSchema: aiperfParamsSchema,
  reportSchema: aiperfReportSchema,
  paramDefaults: aiperfParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric: aiperfReadMetric,
};

export type { AiperfParams, AiperfReport } from "./schema.js";
