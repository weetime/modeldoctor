import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import type { GenaiPerfParams } from "./schema.js";

const NOT_IMPLEMENTED = "genai-perf runtime is implemented in Phase 4 (PR 53.4)";

export function buildCommand(_plan: BuildCommandPlan<GenaiPerfParams>): BuildCommandResult {
  throw new Error(NOT_IMPLEMENTED);
}

export function parseProgress(_line: string): ProgressEvent | null {
  throw new Error(NOT_IMPLEMENTED);
}

export function parseFinalReport(_stdout: string, _files: Record<string, Buffer>): ToolReport {
  throw new Error(NOT_IMPLEMENTED);
}

export function getMaxDurationSeconds(_params: GenaiPerfParams): number {
  throw new Error(NOT_IMPLEMENTED);
}
