// Full adapter export. Imported by apps/api.

export { aiperfAdapter, aiperfReadMetric } from "./aiperf/index.js";
export * from "./core/interface.js";
export * from "./core/progress-event.js";
// Shared readMetricSafe — api side resolves adapters via the registry,
// so a future tool registration is picked up automatically without a
// parallel table.
export { readMetricSafe } from "./core/read-metric-safe.runtime.js";
export * from "./core/registry.js";
export { evalscopeAdapter, evalscopeReadMetric } from "./evalscope/index.js";
export { guidellmAdapter, guidellmReadMetric } from "./guidellm/index.js";
export * from "./scenarios.js";
// Re-export schemas + types for convenience (so `apps/api` doesn't need to
// reach into subpaths to validate `req.params`).
// NOTE: cherry-picked to avoid the `readMetricSafe` re-export from
// schemas-entry conflicting with the runtime variant we expose below
// (each entry uses a different adapter-resolution mechanism: schemas
// drives off pure per-tool functions, runtime drives off byTool).
export {
  AIPERF_CATEGORY_DEFAULTS,
  type AiperfParams,
  type AiperfReport,
  aiperfParamDefaults,
  aiperfParamsSchema,
  aiperfReportSchema,
  EVALSCOPE_CATEGORY_DEFAULTS,
  type EvalscopeParams,
  type EvalscopeReport,
  evalscopeParamDefaults,
  evalscopeParamsSchema,
  evalscopeReportSchema,
  GUIDELLM_CATEGORY_DEFAULTS,
  type GuidellmParams,
  type GuidellmReport,
  guidellmParamDefaults,
  guidellmParamsSchema,
  guidellmRateTypes,
  guidellmReportSchema,
  migrateVegetaParams,
  progressEventSchema,
  SCENARIOS,
  type ScenarioConfig,
  type ScenarioId,
  scenarioIdSchema,
  type Tau3Domain,
  type Tau3Params,
  type Tau3Report,
  tau3DomainSchema,
  tau3ParamDefaults,
  tau3ParamsSchema,
  tau3ReportSchema,
  VEGETA_API_TYPE_TO_BODY,
  VEGETA_API_TYPE_TO_PATH,
  VEGETA_CATEGORY_DEFAULTS,
  type VegetaParams,
  type VegetaReport,
  vegetaParamDefaults,
  vegetaParamsSchema,
  vegetaReportSchema,
} from "./schemas-entry.js";
export { computeGate, type GateResult, tau3Adapter, tau3ReadMetric } from "./tau3/index.js";
export { vegetaAdapter, vegetaReadMetric } from "./vegeta/index.js";
