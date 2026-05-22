import type { EngineId } from "../../engine.js";
import type { EngineManifest } from "../../engine-metrics.js";
import { mindieManifest } from "./mindie.js";
import { sglangManifest } from "./sglang.js";
import { teiManifest } from "./tei.js";
import { tgiManifest } from "./tgi.js";
import { vllmManifest } from "./vllm.js";

const REGISTRY = {
  vllm: vllmManifest,
  sglang: sglangManifest,
  tgi: tgiManifest,
  mindie: mindieManifest,
  tei: teiManifest,
} as const satisfies Partial<Record<EngineId, EngineManifest>>;

export const ENGINE_MANIFEST_IDS = Object.keys(REGISTRY) as Array<keyof typeof REGISTRY>;
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

export function getEngineManifest(id: EngineId): EngineManifest | null {
  return (REGISTRY as Record<string, EngineManifest>)[id] ?? null;
}

export { mindieManifest, sglangManifest, teiManifest, tgiManifest, vllmManifest };
