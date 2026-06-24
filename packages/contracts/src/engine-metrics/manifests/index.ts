import type { EngineId } from "../../engine.js";
import type { EngineManifest } from "../../engine-metrics.js";
import { inferManifest } from "./infer.js";

// Engines ModelDoctor can normalize into the `infer:*` Prometheus namespace
// via the deployed recording rules (deploy/k8s/prometheus-rules). The metric
// SET is now identical across them — one `inferManifest` serves all — so this
// list only drives connection-discovery fingerprinting + the supported-engine
// enum, NOT per-engine PromQL.
export const ENGINE_MANIFEST_IDS = ["vllm", "sglang", "tgi", "tei", "mindie"] as const;
export type SupportedEngineId = (typeof ENGINE_MANIFEST_IDS)[number];

/**
 * Prometheus metric name prefix for each engine. Used by
 * connection-discovery to identify which engine a `/metrics` endpoint
 * belongs to (e.g. presence of `vllm:` prefix → vLLM).
 *
 * Note the inconsistency: vLLM/SGLang/MindIE use `:` separator,
 * TGI uses `_`, TEI uses `te_` (not `tei_`). Matches reality.
 */
export const ENGINE_METRIC_NAMESPACE: Record<SupportedEngineId, string> = {
  vllm: "vllm:",
  sglang: "sglang:",
  tgi: "tgi_",
  tei: "te_",
  mindie: "mindie:",
};

/**
 * All supported engines share the normalized `infer:*` manifest — the
 * Prometheus recording rules absorb every engine/version difference, so the
 * app no longer needs per-engine PromQL. Returns null for unsupported ids.
 */
export function getEngineManifest(id: EngineId): EngineManifest | null {
  return (ENGINE_MANIFEST_IDS as readonly string[]).includes(id) ? inferManifest : null;
}

export { inferManifest };
