import type { ToolAdapter } from "../core/interface.js";
import { guidellmReadMetric } from "./read-metric.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { guidellmParamDefaults, guidellmParamsSchema, guidellmReportSchema } from "./schema.js";

export { guidellmReadMetric } from "./read-metric.js";

export const guidellmAdapter: ToolAdapter = {
  name: "guidellm",
  scenarios: ["inference", "capacity"] as const,
  paramsSchema: guidellmParamsSchema,
  reportSchema: guidellmReportSchema,
  paramDefaults: guidellmParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric: guidellmReadMetric,
};

export type { GuidellmParams, GuidellmReport } from "./schema.js";
