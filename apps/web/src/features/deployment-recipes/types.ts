import type { EngineId } from "@modeldoctor/contracts";

export type { EngineId };

export type RecipeStatus = "native" | "partial" | "none";

export type CategoryId = "dense" | "moe" | "vlm" | "embedding" | "rerank" | "diffusion";

export interface EngineMeta {
  id: EngineId;
  name: string;
  vendor: string;
}

/**
 * Categories are referenced by id only — labels and descriptions live in
 * `apps/web/src/locales/{zh-CN,en-US}/deployment-recipes.json` under
 * `categories.<id>.{label,description}`.
 */
export const CATEGORY_ORDER: CategoryId[] = [
  "dense",
  "moe",
  "vlm",
  "embedding",
  "rerank",
  "diffusion",
];

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
