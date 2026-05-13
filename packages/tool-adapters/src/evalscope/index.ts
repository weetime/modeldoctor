import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { evalscopeParamDefaults, evalscopeParamsSchema, evalscopeReportSchema } from "./schema.js";

export const evalscopeAdapter: ToolAdapter = {
  name: "evalscope",
  scenarios: ["inference", "kv-cache-stress"] as const,
  paramsSchema: evalscopeParamsSchema,
  reportSchema: evalscopeReportSchema,
  paramDefaults: evalscopeParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { EvalscopeParams, EvalscopeReport } from "./schema.js";
