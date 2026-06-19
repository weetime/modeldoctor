// Schema-only entry point. Imported by the frontend (and any other
// consumer that doesn't need the runtime side of adapters).
//
// IMPORTANT: do NOT import anything from `runtime.ts` files transitively
// from this entry point. We don't want `child_process` / `fs` / etc to
// be reachable from the FE bundle. Keep this file's imports limited to
// schema files and pure metric extractors.

export { aiperfReadMetric } from "./aiperf/read-metric.js";
export {
  type AiperfParams,
  type AiperfReport,
  aiperfParamDefaults,
  aiperfParamsSchema,
  aiperfReportSchema,
} from "./aiperf/schema.js";
export {
  AIPERF_CATEGORY_DEFAULTS,
  EVALSCOPE_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
} from "./category-defaults.js";
export type { ProgressEvent, ToolName, ToolReport } from "./core/interface.js";
// Metric kinds + pure per-tool extractors. These files have NO runtime
// dependencies (no child_process, no fs) so FE can safely import them.
export type { MetricKind, ToolMetricExtractor } from "./core/metric-extractor.js";
export { progressEventSchema } from "./core/progress-event.js";
// FE-safe variant of `readMetricSafe` — drives off the pure per-tool
// readMetric exports above, NOT `byTool` (which would pull in adapter
// runtimes via `registry.js`).
export { readMetricSafe } from "./core/read-metric-safe.fe.js";
// Compare-grid row descriptors. Each adapter owns its row set in
// `<adapter>/row-descriptors.ts`; the aggregated `Record<ToolName, …>`
// gives FE a single import + compile-time exhaustiveness when a new tool
// joins `ToolName`.
export type { MetricFormat, MetricRowSpec, VerdictKind } from "./core/row-descriptor.js";
export { rowDescriptorsByTool } from "./core/row-descriptors.fe.js";
export { evalscopeReadMetric } from "./evalscope/read-metric.js";
export {
  type EvalscopeParams,
  type EvalscopeReport,
  evalscopeParamDefaults,
  evalscopeParamsSchema,
  evalscopeReportSchema,
} from "./evalscope/schema.js";
export { guidellmReadMetric } from "./guidellm/read-metric.js";
export {
  type GuidellmParams,
  type GuidellmReport,
  guidellmParamDefaults,
  guidellmParamsSchema,
  guidellmRateTypes,
  guidellmReportSchema,
} from "./guidellm/schema.js";
export {
  SCENARIOS,
  type ScenarioConfig,
  type ScenarioId,
  scenarioIdSchema,
} from "./scenarios.js";
export { migrateVegetaParams } from "./vegeta/migrate-params.js";
export { vegetaReadMetric } from "./vegeta/read-metric.js";
export {
  API_TYPE_TO_BODY as VEGETA_API_TYPE_TO_BODY,
  API_TYPE_TO_PATH as VEGETA_API_TYPE_TO_PATH,
} from "./vegeta/runtime.js";
export {
  type VegetaParams,
  type VegetaReport,
  vegetaParamDefaults,
  vegetaParamsSchema,
  vegetaReportSchema,
} from "./vegeta/schema.js";
