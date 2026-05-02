import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import type { GuidellmParams } from "./schema.js";

const NOT_IMPLEMENTED = "guidellm runtime is implemented in Phase 3 (PR 53.3)";

export function buildCommand(_plan: BuildCommandPlan<GuidellmParams>): BuildCommandResult {
  throw new Error(NOT_IMPLEMENTED);
}

export function parseProgress(_line: string): ProgressEvent | null {
  throw new Error(NOT_IMPLEMENTED);
}

export function parseFinalReport(_stdout: string, _files: Record<string, Buffer>): ToolReport {
  throw new Error(NOT_IMPLEMENTED);
}
