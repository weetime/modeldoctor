import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { genaiPerfParamDefaults, genaiPerfParamsSchema, genaiPerfReportSchema } from "./schema.js";

export const genaiPerfAdapter: ToolAdapter = {
  name: "genai-perf",
  paramsSchema: genaiPerfParamsSchema,
  reportSchema: genaiPerfReportSchema,
  paramDefaults: genaiPerfParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { GenaiPerfParams, GenaiPerfReport } from "./schema.js";
