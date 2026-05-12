import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import {
  kvCacheStressParamDefaults,
  kvCacheStressParamsSchema,
  kvCacheStressReportSchema,
} from "./schema.js";

export const kvCacheStressAdapter: ToolAdapter = {
  name: "kv-cache-stress",
  scenarios: ["kv-cache-stress"] as const,
  paramsSchema: kvCacheStressParamsSchema,
  reportSchema: kvCacheStressReportSchema,
  paramDefaults: kvCacheStressParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { KvCacheStressParams, KvCacheStressReport } from "./schema.js";
