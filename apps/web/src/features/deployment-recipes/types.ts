export type RecipeStatus = "native" | "partial" | "none";

export type EngineId =
  | "vllm"
  | "sglang"
  | "trtllm"
  | "mindie"
  | "lmdeploy"
  | "tgi"
  | "tei"
  | "infinity"
  | "llamacpp"
  | "comfyui";

export type CategoryId = "dense" | "moe" | "vlm" | "embedding" | "rerank" | "diffusion";

export interface EngineMeta {
  id: EngineId;
  name: string;
  vendor: string;
}

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  description: string;
}

export interface RecipeParam {
  key: string;
  value: string;
  desc: string;
}

export interface EngineRecipe {
  status: RecipeStatus;
  minVersion?: string;
  image?: string;
  command?: string;
  params?: RecipeParam[];
  resource?: string;
  notes?: string;
  docUrl?: string;
  /** Short tooltip shown on hover over the matrix cell. */
  tooltip?: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  category: CategoryId;
  /** "vendor · short tag" — rendered under the model name in the first column. */
  meta: string;
  engines: Partial<Record<EngineId, EngineRecipe>>;
}
