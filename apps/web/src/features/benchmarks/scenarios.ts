import { SCENARIOS, type ScenarioId } from "@modeldoctor/tool-adapters/schemas";
import { Activity, Gauge, Network, type LucideIcon } from "lucide-react";

export const SCENARIO_ICONS: Record<ScenarioId, LucideIcon> = {
  inference: Gauge,
  capacity: Activity,
  gateway: Network,
};

export { SCENARIOS, type ScenarioId };
