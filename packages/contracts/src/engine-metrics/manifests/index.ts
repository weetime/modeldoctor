import type { EngineManifest } from "../../engine-metrics.js";
import type { EngineId } from "../../engine.js";
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

export function getEngineManifest(id: EngineId): EngineManifest | null {
  return (REGISTRY as Record<string, EngineManifest>)[id] ?? null;
}

export { mindieManifest, sglangManifest, teiManifest, tgiManifest, vllmManifest };
