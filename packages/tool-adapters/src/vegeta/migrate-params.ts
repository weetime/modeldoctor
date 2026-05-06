import { API_TYPE_TO_BODY, API_TYPE_TO_PATH } from "./runtime.js";
import type { VegetaParams } from "./schema.js";

type LegacyVegetaParams = Pick<VegetaParams, "apiType" | "rate" | "duration"> & {
  path?: string;
  body?: string;
};

/**
 * Backwards-compat helper for benchmarks created before vegetaParamsSchema
 * required `path` + `body`. Fills the two new fields from the apiType-keyed
 * defaults so legacy rows survive both the detail-page render and the
 * "rerun" mutation (whose POST goes through the now-stricter schema).
 */
export function migrateVegetaParams(
  params: LegacyVegetaParams,
  connectionModel: string | null | undefined,
): VegetaParams {
  const model = connectionModel ?? "<unknown>";
  return {
    apiType: params.apiType,
    rate: params.rate,
    duration: params.duration,
    path: params.path ?? API_TYPE_TO_PATH[params.apiType],
    body: params.body ?? API_TYPE_TO_BODY[params.apiType](model),
  };
}
