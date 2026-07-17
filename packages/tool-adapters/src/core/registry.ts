import { aiperfAdapter } from "../aiperf/index.js";
import { evalscopeAdapter } from "../evalscope/index.js";
import { guidellmAdapter } from "../guidellm/index.js";
import type { ScenarioId } from "../scenarios.js";
import { tau3Adapter } from "../tau3/index.js";
import { vegetaAdapter } from "../vegeta/index.js";
import { vllmOmniBenchAdapter } from "../vllm-omni-bench/index.js";
import type { ToolAdapter, ToolName } from "./interface.js";

const ADAPTERS: Readonly<Record<ToolName, ToolAdapter>> = {
  guidellm: guidellmAdapter,
  vegeta: vegetaAdapter,
  evalscope: evalscopeAdapter,
  aiperf: aiperfAdapter,
  tau3: tau3Adapter,
  "vllm-omni-bench": vllmOmniBenchAdapter,
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
