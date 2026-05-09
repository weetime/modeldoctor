import { SCENARIOS, type ScenarioId } from "@modeldoctor/tool-adapters/schemas";
import { Activity, Gauge, Layers, type LucideIcon, Network } from "lucide-react";

/**
 * Lucide icon for each scenario, consumed by the sidebar in Phase 14.
 * Exported now so the icon→scenario mapping lives next to SCENARIOS.
 */
export const SCENARIO_ICONS: Record<ScenarioId, LucideIcon> = {
  inference: Gauge,
  capacity: Activity,
  gateway: Network,
  "prefix-cache-validation": Layers,
};

export { SCENARIOS, type ScenarioId };
