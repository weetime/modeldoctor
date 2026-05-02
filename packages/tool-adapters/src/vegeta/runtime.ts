import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import type { VegetaParams } from "./schema.js";

const NOT_IMPLEMENTED = "vegeta runtime is implemented in Phase 3 (PR 53.3)";

export function buildCommand(_plan: BuildCommandPlan<VegetaParams>): BuildCommandResult {
  throw new Error(NOT_IMPLEMENTED);
}

export function parseProgress(_line: string): ProgressEvent | null {
  // vegeta has no native progress emission — final shape will return null
  // unconditionally. We still throw here so the stub is uniform with the
  // other adapters; Phase 3 replaces this with `return null`.
  throw new Error(NOT_IMPLEMENTED);
}

export function parseFinalReport(
  _stdout: string,
  _files: Record<string, Buffer>,
): ToolReport {
  throw new Error(NOT_IMPLEMENTED);
}
