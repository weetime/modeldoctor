import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";
import { guidellmParamDefaults, guidellmParamsSchema, guidellmReportSchema } from "./schema.js";

export const guidellmAdapter: ToolAdapter = {
  name: "guidellm",
  paramsSchema: guidellmParamsSchema,
  reportSchema: guidellmReportSchema,
  paramDefaults: guidellmParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
};

export type { GuidellmParams, GuidellmReport } from "./schema.js";
