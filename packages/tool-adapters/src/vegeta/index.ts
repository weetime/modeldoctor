import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";
import { vegetaParamDefaults, vegetaParamsSchema, vegetaReportSchema } from "./schema.js";

export const vegetaAdapter: ToolAdapter = {
  name: "vegeta",
  paramsSchema: vegetaParamsSchema,
  reportSchema: vegetaReportSchema,
  paramDefaults: vegetaParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
};

export type { VegetaParams, VegetaReport } from "./schema.js";
