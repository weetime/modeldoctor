import type { ToolAdapter } from "../core/interface.js";
import { vegetaReadMetric } from "./read-metric.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { vegetaParamDefaults, vegetaParamsSchema, vegetaReportSchema } from "./schema.js";

export { vegetaReadMetric } from "./read-metric.js";

export const vegetaAdapter: ToolAdapter = {
  name: "vegeta",
  scenarios: ["gateway"] as const,
  paramsSchema: vegetaParamsSchema,
  reportSchema: vegetaReportSchema,
  paramDefaults: vegetaParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric: vegetaReadMetric,
};

export type { VegetaParams, VegetaReport } from "./schema.js";
