import { byTool, type ToolName } from "@modeldoctor/tool-adapters";

/**
 * Whether a tool's runs can be resumed from a checkpoint after a mid-flight
 * failure (currently only tau3, via its `checkpointDir`). Unknown tool names
 * (e.g. already-retired enum values still present on old rows) resolve to
 * false rather than throwing — `byTool` throws for unregistered tools, and a
 * resumability check must never crash the reconciler/watcher.
 */
export function isResumable(tool: string): boolean {
  try {
    return byTool(tool as ToolName).checkpointDir != null;
  } catch {
    return false;
  }
}
