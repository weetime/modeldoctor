// Schema-only entry point. Imported by the frontend (and any other
// consumer that doesn't need the runtime side of adapters).
//
// IMPORTANT: do NOT import anything from `runtime.ts` files transitively
// from this entry point. We don't want `child_process` / `fs` / etc to
// be reachable from the FE bundle. Keep this file's imports limited to
// schema files.

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
  genaiPerfParamsSchema,
  genaiPerfReportSchema,
  genaiPerfParamDefaults,
  type GenaiPerfParams,
  type GenaiPerfReport,
} from "./genai-perf/schema.js";

export {
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
  prefixCacheProbeParamDefaults,
  type PrefixCacheProbeParams,
  type PrefixCacheProbeReport,
} from "./prefix-cache-probe/schema.js";

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
  GENAI_PERF_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
  PREFIX_CACHE_PROBE_CATEGORY_DEFAULTS,
} from "./category-defaults.js";
