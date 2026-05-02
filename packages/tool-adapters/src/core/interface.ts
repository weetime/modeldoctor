import type { z } from "zod";

// ToolAdapter-registered tool names. The DB column `Run.tool` allows a
// superset (additionally `'e2e'` and `'custom'`) — those don't go through
// ToolAdapter and follow their own codepaths. ToolName covers exactly the
// adapters the registry knows about.
export type ToolName = "guidellm" | "genai-perf" | "vegeta";

// ── Progress events (uniform across tools) ────────────────────────────
export type ProgressEvent =
  | { kind: "progress"; pct: number; currentRequests?: number; message?: string }
  | { kind: "log"; level: "info" | "warn" | "error"; line: string };

// ── Forward-declare per-tool report types (filled in Task 1.4 / 1.5 / 1.6) ──
// We use type-only imports to break a circular dep concern: schema files
// don't import from interface.ts; interface.ts imports their inferred types.
import type { GuidellmReport } from "../guidellm/schema.js";
import type { GenaiPerfReport } from "../genai-perf/schema.js";
import type { VegetaReport } from "../vegeta/schema.js";

// ── Discriminated union: report (consumers switch on `tool`) ──────────
export type ToolReport =
  | { tool: "guidellm"; data: GuidellmReport }
  | { tool: "genai-perf"; data: GenaiPerfReport }
  | { tool: "vegeta"; data: VegetaReport };

// ── buildCommand inputs ───────────────────────────────────────────────
export interface BuildCommandPlan<TParams = unknown> {
  runId: string;
  params: TParams;
  connection: {
    baseUrl: string;
    apiKey: string;
    model: string;
    customHeaders: string;
    queryParams: string;
  };
  callback: { url: string; token: string };
}

// ── buildCommand output ───────────────────────────────────────────────
//
// Driver contract:
//   - argv:        full command (incl. program name); shell pipelines via
//                  ['/bin/sh', '-c', '...']. Driver does NOT prepend.
//   - env:         non-sensitive env. Subprocess: merged into spawn env.
//                  K8s: passed as Job container env value.
//   - secretEnv:   sensitive env. Subprocess: merged into spawn env (no
//                  argv leak). K8s: written to per-run Secret + envFrom.
//                  MUST NOT enter argv.
//   - inputFiles:  cwd-relative path → file contents. Driver writes these
//                  before spawn. K8s: written to the same per-run Secret +
//                  volumeMount (single-Secret limit ~1MiB total). Use this
//                  channel for files that contain secrets (e.g. vegeta's
//                  targets.txt with bearer token); never use ConfigMap.
//   - outputFiles: alias → cwd-relative path. Runner reads these after
//                  exit and ships base64-encoded contents in /finish body.
export interface BuildCommandResult {
  argv: string[];
  env: Record<string, string>;
  secretEnv: Record<string, string>;
  inputFiles?: Record<string, string>;
  outputFiles: Record<string, string>;
}

// ── ToolAdapter interface ─────────────────────────────────────────────
// ⚠ ACCEPTANCE GATE: in Phase 4 (PR 53.4), `git diff main -- this file`
// MUST be empty. Adding genai-perf must not require any change here.
export interface ToolAdapter {
  readonly name: ToolName;
  readonly paramsSchema: z.ZodTypeAny;
  readonly reportSchema: z.ZodTypeAny;
  readonly paramDefaults: unknown;

  buildCommand(plan: BuildCommandPlan): BuildCommandResult;
  parseProgress(line: string): ProgressEvent | null;
  parseFinalReport(stdout: string, files: Record<string, Buffer>): ToolReport;
}
