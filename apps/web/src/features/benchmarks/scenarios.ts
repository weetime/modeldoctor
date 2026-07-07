import { SCENARIOS, type ScenarioId } from "@modeldoctor/tool-adapters/schemas";
import { Activity, Bot, Database, Gauge, Layers, type LucideIcon, Network } from "lucide-react";

/**
 * Lucide icon for each scenario, consumed by the sidebar in Phase 14.
 * Exported now so the icon→scenario mapping lives next to SCENARIOS.
 */
export const SCENARIO_ICONS: Record<ScenarioId, LucideIcon> = {
  inference: Gauge,
  capacity: Activity,
  gateway: Network,
  "lb-strategy": Layers,
  "engine-kv-cache": Database,
  agent: Bot,
};

export { SCENARIOS, type ScenarioId };
