import type { ToolAdapter } from "../core/interface.js";
import { vegetaParamsSchema, vegetaReportSchema, vegetaParamDefaults } from "./schema.js";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";

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
