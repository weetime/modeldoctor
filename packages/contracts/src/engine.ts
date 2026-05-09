import { z } from "zod";

/**
 * Single source of truth for inference engine IDs.
 * Each engine must appear exactly once. New engines require changes here + tests.
 */
export const ENGINE_IDS = [
  "vllm",
  "sglang",
  "trtllm",
  "mindie",
  "lmdeploy",
  "tgi",
  "tei",
  "infinity",
  "llamacpp",
  "comfyui",
] as const;

/**
 * Type-safe engine identifier. Derives from ENGINE_IDS to ensure consistency.
 * Use this for fields that reference a specific engine.
 */
export type EngineId = (typeof ENGINE_IDS)[number];

/**
 * Display name to render anywhere an engine is identified across the app
 * (Connection form dropdown, Engine Metrics section header, etc.). The
 * deployment-recipes feature has its own ENGINES table in
 * apps/web/.../deployment-recipes/data.ts with vendor-tagged variants
 * ("ComfyUI / Diffusers" etc.) — those are intentionally scoped to that
 * matrix view and do NOT need to match this map.
 */
export const ENGINE_DISPLAY_NAME: Record<EngineId, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  trtllm: "TensorRT-LLM",
  mindie: "MindIE",
  lmdeploy: "LMDeploy",
  tgi: "TGI",
  tei: "TEI",
  infinity: "Infinity",
  llamacpp: "llama.cpp",
  comfyui: "ComfyUI",
};

/**
 * Engine capability category: generative models or embedding-only models.
 * Guides filtering and UI logic throughout the application.
 */
export type EngineCapability = "generative" | "embedding";

/**
 * Capability mapping for each engine. Must have an entry for every EngineId.
 * Use to filter engines by their primary function (e.g., show only embedding engines).
 */
export const ENGINE_CAPABILITY: Record<EngineId, EngineCapability> = {
  vllm: "generative",
  sglang: "generative",
  trtllm: "generative",
  mindie: "generative",
  lmdeploy: "generative",
  tgi: "generative",
  tei: "embedding",
  infinity: "embedding",
  llamacpp: "generative",
  // M2 placeholder: ComfyUI is diffusion, not autoregressive generation.
  // Replace with a "diffusion" capability when Group C panels land.
  comfyui: "generative",
};

/**
 * Zod schema for engine capability literals. Shared with engine-metrics
 * to avoid silent drift if a third capability is added.
 */
export const engineCapabilitySchema = z.enum(["generative", "embedding"]);
