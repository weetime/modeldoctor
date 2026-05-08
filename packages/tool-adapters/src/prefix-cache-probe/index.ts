import type { ToolAdapter } from "../core/interface.js";
import {
  buildCommand,
  getMaxDurationSeconds,
  parseFinalReport,
  parseProgress,
} from "./runtime.js";
import {
  prefixCacheProbeParamDefaults,
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
} from "./schema.js";

export const prefixCacheProbeAdapter: ToolAdapter = {
  name: "prefix-cache-probe",
  scenarios: ["prefix-cache-validation"] as const,
  paramsSchema: prefixCacheProbeParamsSchema,
  reportSchema: prefixCacheProbeReportSchema,
  paramDefaults: prefixCacheProbeParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type {
  PrefixCacheProbeParams,
  PrefixCacheProbeReport,
} from "./schema.js";
