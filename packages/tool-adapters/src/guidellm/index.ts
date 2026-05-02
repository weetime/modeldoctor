import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { guidellmParamDefaults, guidellmParamsSchema, guidellmReportSchema } from "./schema.js";

export const guidellmAdapter: ToolAdapter = {
  name: "guidellm",
  paramsSchema: guidellmParamsSchema,
  reportSchema: guidellmReportSchema,
  paramDefaults: guidellmParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { GuidellmParams, GuidellmReport } from "./schema.js";
