import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { aiperfParamDefaults, aiperfParamsSchema, aiperfReportSchema } from "./schema.js";

export const aiperfAdapter: ToolAdapter = {
  name: "aiperf",
  scenarios: ["inference"] as const,
  paramsSchema: aiperfParamsSchema,
  reportSchema: aiperfReportSchema,
  paramDefaults: aiperfParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { AiperfParams, AiperfReport } from "./schema.js";
