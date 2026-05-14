// Full adapter export. Imported by apps/api.

export * from "./core/interface.js";
export * from "./core/registry.js";
export * from "./core/progress-event.js";

export { guidellmAdapter, guidellmReadMetric } from "./guidellm/index.js";
export { vegetaAdapter, vegetaReadMetric } from "./vegeta/index.js";
export {
  prefixCacheProbeAdapter,
  prefixCacheProbeReadMetric,
} from "./prefix-cache-probe/index.js";
export { evalscopeAdapter, evalscopeReadMetric } from "./evalscope/index.js";
export { aiperfAdapter, aiperfReadMetric } from "./aiperf/index.js";

// Re-export schemas + types for convenience (so `apps/api` doesn't need to
// reach into subpaths to validate `req.params`).
// NOTE: cherry-picked to avoid the `readMetricSafe` re-export from
// schemas-entry conflicting with the runtime variant we expose below
// (each entry uses a different adapter-resolution mechanism: schemas
// drives off pure per-tool functions, runtime drives off byTool).
export {
  guidellmParamsSchema,
  guidellmReportSchema,
  guidellmParamDefaults,
  guidellmRateTypes,
  type GuidellmParams,
  type GuidellmReport,
  vegetaParamsSchema,
  vegetaReportSchema,
  vegetaParamDefaults,
  type VegetaParams,
  type VegetaReport,
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
  prefixCacheProbeParamDefaults,
  type PrefixCacheProbeParams,
  type PrefixCacheProbeReport,
  evalscopeParamsSchema,
  evalscopeReportSchema,
  evalscopeParamDefaults,
  type EvalscopeParams,
  type EvalscopeReport,
  aiperfParamsSchema,
  aiperfReportSchema,
  aiperfParamDefaults,
  type AiperfParams,
  type AiperfReport,
  progressEventSchema,
  SCENARIOS,
  scenarioIdSchema,
  type ScenarioId,
  type ScenarioConfig,
  VEGETA_API_TYPE_TO_BODY,
  VEGETA_API_TYPE_TO_PATH,
  migrateVegetaParams,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
  PREFIX_CACHE_PROBE_CATEGORY_DEFAULTS,
  EVALSCOPE_CATEGORY_DEFAULTS,
  AIPERF_CATEGORY_DEFAULTS,
} from "./schemas-entry.js";

// Shared readMetricSafe — api side resolves adapters via the registry,
// so a future tool registration is picked up automatically without a
// parallel table.
export { readMetricSafe } from "./core/read-metric-safe.runtime.js";

export * from "./scenarios.js";
