import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";
import { genaiPerfParamDefaults, genaiPerfParamsSchema, genaiPerfReportSchema } from "./schema.js";

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
