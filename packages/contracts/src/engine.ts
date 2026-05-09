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
 * Display name for each engine, used in UI labels and tables.
 * Must have an entry for every EngineId.
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
  comfyui: "generative",
};
