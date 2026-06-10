import { aiperfAdapter } from "../aiperf/index.js";
import { evalscopeAdapter } from "../evalscope/index.js";
import { guidellmAdapter } from "../guidellm/index.js";
import type { ScenarioId } from "../scenarios.js";
import { vegetaAdapter } from "../vegeta/index.js";
import type { ToolAdapter, ToolName } from "./interface.js";

const ADAPTERS: Readonly<Record<ToolName, ToolAdapter>> = {
  guidellm: guidellmAdapter,
  vegeta: vegetaAdapter,
  evalscope: evalscopeAdapter,
  aiperf: aiperfAdapter,
};

export function byTool(tool: ToolName): ToolAdapter {
  const a = ADAPTERS[tool];
  if (!a) throw new Error(`No adapter registered for tool: ${tool}`);
  return a;
}

export function allAdapters(): readonly ToolAdapter[] {
  return Object.values(ADAPTERS);
}

export function byScenario(scenario: ScenarioId): ToolAdapter[] {
  return allAdapters().filter((a) => a.scenarios.includes(scenario));
}
