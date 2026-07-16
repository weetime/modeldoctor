import type { ScenarioId } from "../scenarios.js";
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
  // TODO(Task 5): "omni" isn't in ScenarioId yet (scenarios.ts owns that
  // registration) — cast until Task 5 lands it. assertScenariosInvariant
  // will fail until then; expected per task-4 brief.
  scenarios: ["omni"] as unknown as readonly ScenarioId[],
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
