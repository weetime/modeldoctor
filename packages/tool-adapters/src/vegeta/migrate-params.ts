import { API_TYPE_TO_BODY, API_TYPE_TO_PATH } from "./runtime.js";
import type { VegetaParams } from "./schema.js";

type LegacyVegetaParams = Pick<VegetaParams, "apiType" | "rate" | "duration"> & {
  path?: string;
  body?: string;
};

/** Placeholder used in seed templates; replaced at display / rerun time. */
const SEED_MODEL_PLACEHOLDER = "<replace-with-your-model>";

/**
 * Backwards-compat helper for benchmarks created before vegetaParamsSchema
 * required `path` + `body`. Fills the two new fields from the apiType-keyed
 * defaults so legacy rows survive both the detail-page render and the
 * "rerun" mutation (whose POST goes through the now-stricter schema).
 *
 * Also substitutes the seed-template placeholder model with the live
 * connection model so Copy-as-cURL produces a runnable command.
 */
export function migrateVegetaParams(
  params: LegacyVegetaParams,
  connectionModel: string | null | undefined,
): VegetaParams {
  const model = connectionModel ?? "<unknown>";
  let body = params.body ?? API_TYPE_TO_BODY[params.apiType](model);
  if (connectionModel && body.includes(SEED_MODEL_PLACEHOLDER)) {
    body = body.replaceAll(SEED_MODEL_PLACEHOLDER, connectionModel);
  }
  return {
    apiType: params.apiType,
    rate: params.rate,
    duration: params.duration,
    path: params.path ?? API_TYPE_TO_PATH[params.apiType],
    body,
  };
}
