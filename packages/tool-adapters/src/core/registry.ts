import { genaiPerfAdapter } from "../genai-perf/index.js";
import { guidellmAdapter } from "../guidellm/index.js";
import { vegetaAdapter } from "../vegeta/index.js";
import type { ToolAdapter, ToolName } from "./interface.js";

const ADAPTERS: Readonly<Record<ToolName, ToolAdapter>> = {
  guidellm: guidellmAdapter,
  "genai-perf": genaiPerfAdapter,
  vegeta: vegetaAdapter,
};

export function byTool(tool: ToolName): ToolAdapter {
  const a = ADAPTERS[tool];
  if (!a) throw new Error(`No adapter registered for tool: ${tool}`);
  return a;
}

export function allAdapters(): readonly ToolAdapter[] {
  return Object.values(ADAPTERS);
}
