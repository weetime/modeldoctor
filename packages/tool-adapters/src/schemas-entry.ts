// Schema-only entry point. Imported by the frontend (and any other
// consumer that doesn't need the runtime side of adapters).
//
// IMPORTANT: do NOT import anything from `runtime.ts` files transitively
// from this entry point. We don't want `child_process` / `fs` / etc to
// be reachable from the FE bundle. Keep this file's imports limited to
// schema files and pure metric extractors.

export {
  guidellmParamsSchema,
  guidellmReportSchema,
  guidellmParamDefaults,
  guidellmRateTypes,
  type GuidellmParams,
  type GuidellmReport,
} from "./guidellm/schema.js";

export {
  vegetaParamsSchema,
  vegetaReportSchema,
  vegetaParamDefaults,
  type VegetaParams,
  type VegetaReport,
} from "./vegeta/schema.js";

export {
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
  prefixCacheProbeParamDefaults,
  type PrefixCacheProbeParams,
  type PrefixCacheProbeReport,
} from "./prefix-cache-probe/schema.js";

export {
  evalscopeParamsSchema,
  evalscopeReportSchema,
  evalscopeParamDefaults,
  type EvalscopeParams,
  type EvalscopeReport,
} from "./evalscope/schema.js";

export {
  aiperfParamsSchema,
  aiperfReportSchema,
  aiperfParamDefaults,
  type AiperfParams,
  type AiperfReport,
} from "./aiperf/schema.js";

export type { ToolName, ProgressEvent, ToolReport } from "./core/interface.js";
export { progressEventSchema } from "./core/progress-event.js";

export {
  SCENARIOS,
  scenarioIdSchema,
  type ScenarioId,
  type ScenarioConfig,
} from "./scenarios.js";

export {
  API_TYPE_TO_BODY as VEGETA_API_TYPE_TO_BODY,
  API_TYPE_TO_PATH as VEGETA_API_TYPE_TO_PATH,
} from "./vegeta/runtime.js";
export { migrateVegetaParams } from "./vegeta/migrate-params.js";
export {
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
  PREFIX_CACHE_PROBE_CATEGORY_DEFAULTS,
  EVALSCOPE_CATEGORY_DEFAULTS,
  AIPERF_CATEGORY_DEFAULTS,
} from "./category-defaults.js";

// Metric kinds + pure per-tool extractors. These files have NO runtime
// dependencies (no child_process, no fs) so FE can safely import them.
export type { MetricKind, ToolMetricExtractor } from "./core/metric-extractor.js";
export { guidellmReadMetric } from "./guidellm/read-metric.js";
export { vegetaReadMetric } from "./vegeta/read-metric.js";
export { prefixCacheProbeReadMetric } from "./prefix-cache-probe/read-metric.js";
export { evalscopeReadMetric } from "./evalscope/read-metric.js";
export { aiperfReadMetric } from "./aiperf/read-metric.js";

// FE-safe variant of `readMetricSafe` — drives off the pure per-tool
// readMetric exports above, NOT `byTool` (which would pull in adapter
// runtimes via `registry.js`).
export { readMetricSafe } from "./core/read-metric-safe.fe.js";
