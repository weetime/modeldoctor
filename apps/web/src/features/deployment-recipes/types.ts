import type { EngineId } from "@modeldoctor/contracts";

export type { EngineId };

/**
 * Recipe support status.
 *
 * - `native`    upstream-supported, ships in the engine vendor's release
 * - `partial`   upstream supports the model but with caveats (kernel
 *               compatibility, slower path, etc.)
 * - `community` not upstream — the recipe ships an internally-built image,
 *               a hot-patch, or both. The UI labels these clearly so
 *               operators know the maintenance burden falls on us
 * - `none`     known not to work; the cell stays empty / dimmed
 */
export type RecipeStatus = "native" | "partial" | "community" | "none";

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
