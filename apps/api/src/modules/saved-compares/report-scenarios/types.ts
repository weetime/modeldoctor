import type { FigureRefId, HydratedSavedCompare } from "@modeldoctor/contracts";

export type Locale = "zh-CN" | "en-US";

/** Stable intent keys — finer than scenario (inference splits by run count). */
export type ReportIntent =
  | "lb-strategy"
  | "engine-kv-cache"
  | "capacity"
  | "gateway"
  | "inference-single"
  | "inference-multi"
  | "default";

/** Scenario-specific data the profile assembled from the hydrated compare,
 * passed to both the user-prompt builder and the figure manifest. */
export interface ScenarioData {
  /** Extra markdown block injected into the user prompt (per-pod table,
   * cold/warm pairing, capacity curve summary, …). Empty string = none. */
  promptBlock: string;
  /** refIds the profile wants offered to the LLM, intersected later with the
   * data-availability set so empty charts never get offered. */
  preferredFigures: FigureRefId[];
}

export interface ReportScenarioProfile {
  intent: ReportIntent;
  /** Injected after the common base in the system prompt. */
  promptFragment: (locale: Locale) => string;
  /** Assemble scenario data from the hydrated compare. */
  dataAssembly: (sc: HydratedSavedCompare) => ScenarioData;
}
