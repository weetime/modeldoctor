import type { ToolAdapter } from "../core/interface.js";
import { vllmOmniBenchReadMetric } from "./read-metric.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import {
  vllmOmniBenchParamDefaults,
  vllmOmniBenchParamsSchema,
  vllmOmniBenchReportSchema,
} from "./schema.js";

export { vllmOmniBenchReadMetric } from "./read-metric.js";
export { vllmOmniBenchRowDescriptors } from "./row-descriptors.js";

export const vllmOmniBenchAdapter: ToolAdapter = {
  name: "vllm-omni-bench",
  scenarios: ["omni"] as const,
  paramsSchema: vllmOmniBenchParamsSchema,
  reportSchema: vllmOmniBenchReportSchema,
  paramDefaults: vllmOmniBenchParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric: vllmOmniBenchReadMetric,
};

export type { VllmOmniBenchParams, VllmOmniBenchReport } from "./schema.js";
