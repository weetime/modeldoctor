import type { ToolAdapter } from "../core/interface.js";
import { genaiPerfParamsSchema, genaiPerfReportSchema, genaiPerfParamDefaults } from "./schema.js";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";

export const genaiPerfAdapter: ToolAdapter = {
  name: "genai-perf",
  paramsSchema: genaiPerfParamsSchema,
  reportSchema: genaiPerfReportSchema,
  paramDefaults: genaiPerfParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
};

export type { GenaiPerfParams, GenaiPerfReport } from "./schema.js";
