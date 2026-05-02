import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { vegetaParamDefaults, vegetaParamsSchema, vegetaReportSchema } from "./schema.js";

export const vegetaAdapter: ToolAdapter = {
  name: "vegeta",
  paramsSchema: vegetaParamsSchema,
  reportSchema: vegetaReportSchema,
  paramDefaults: vegetaParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { VegetaParams, VegetaReport } from "./schema.js";
