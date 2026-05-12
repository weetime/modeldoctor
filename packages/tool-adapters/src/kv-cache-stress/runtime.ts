import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type KvCacheStressParams, kvCacheStressReportSchema } from "./schema.js";

// Progress lines from kv_cache_stress.py look like:
//   "  + 15s  ok=100  err=2  completion_tokens=4830"
// (anchored on the leading two spaces + `+`, integer seconds, then key=val pairs)
//
// The script also emits a final SUMMARY block which parseFinalReport reads from
// the captured result file, not from this stream.
const PROGRESS_LINE = /^\s*\+\s*(\d+)s\s+ok=(\d+)\s+err=(\d+)(?:\s+completion_tokens=(\d+))?/;

export function buildCommand(plan: BuildCommandPlan<KvCacheStressParams>): BuildCommandResult {
  const { params, connection } = plan;

  // Argv only carries non-secret strings. The bearer token rides via env
  // (OPENAI_API_KEY) so it never enters Job spec / ps aux.
  const argv = [
    "python",
    "/app/probe.py",
    "--base-url",
    connection.baseUrl,
    "--model",
    connection.model,
    "--num-sessions",
    String(params.numSessions),
    "--turns",
    String(params.turns),
    "--concurrency",
    String(params.concurrency),
    "--max-tokens",
    String(params.maxTokens),
    "--duration",
    String(params.durationSec),
    "--system-prompt-seed",
    params.systemPromptSeed,
    "--out",
    "result.json",
  ];

  // Prom URL is optional — when present the script captures vllm:* counter
  // deltas before/after the bench and computes Prefix Cache Savings.
  if (connection.prometheusUrl) {
    argv.push("--prom-url", connection.prometheusUrl);
  }

  return {
    argv,
    env: {},
    secretEnv: {
      OPENAI_API_KEY: connection.apiKey,
    },
    outputFiles: {
      result: "result.json",
    },
  };
}

export function parseProgress(line: string): ProgressEvent | null {
  const m = PROGRESS_LINE.exec(line);
  if (!m) return null;
  const [, _elapsedStr, okStr, errStr] = m;
  const ok = Number.parseInt(okStr, 10);
  const err = Number.parseInt(errStr, 10);
  return {
    kind: "progress",
    pct: 0, // duration-relative pct lives in the driver; we just emit absolute counts
    currentRequests: ok + err,
    message: `ok=${ok} err=${err}`,
  };
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const buf = files.result;
  if (!buf) {
    throw new Error("kv-cache-stress.parseFinalReport: missing 'result' output file");
  }
  const data = kvCacheStressReportSchema.parse(JSON.parse(buf.toString("utf8")));
  return { tool: "kv-cache-stress", data };
}

export function getMaxDurationSeconds(params: KvCacheStressParams): number {
  // bench wall-clock + warmup grace + pre/post Prom snapshot + report-file write.
  // 90s buffer matches the worst case observed in the 2026-05-11 runs where
  // pod readiness lag pushed start time ~60s past invocation.
  return params.durationSec + 120;
}
