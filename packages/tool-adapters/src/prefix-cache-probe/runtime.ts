import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type PrefixCacheProbeParams, prefixCacheProbeReportSchema } from "./schema.js";

export function buildCommand(plan: BuildCommandPlan<PrefixCacheProbeParams>): BuildCommandResult {
  const { params, connection } = plan;
  if (!connection.prometheusDatasource) {
    throw new Error(
      "prefix-cache-probe requires the connection to be bound to a Prometheus datasource",
    );
  }

  // Argv passes user-supplied strings (baseUrl, prom baseUrl, model) as
  // separate argv entries — Python argparse doesn't shell-expand them, so
  // there's no injection surface. Bearer (when present) ships via
  // secretEnv below so it never lands on the kubelet's command line.
  const argv = [
    "python",
    "/app/probe.py",
    "--url",
    connection.baseUrl,
    "--prom",
    connection.prometheusDatasource.baseUrl,
    "--model",
    connection.model,
    "--rounds",
    String(params.promptSets),
    "--requests",
    String(params.requestsPerSet),
    "--max-tokens",
    String(params.maxTokens),
    "--backoff",
    String(params.promBackoffSec),
    "--out",
    "result.json",
  ];

  const secretEnv: Record<string, string> = {
    OPENAI_API_KEY: connection.apiKey,
  };
  // Forward the datasource bearer when configured. probe.py reads
  // PROM_BEARER_TOKEN and adds an `Authorization: Bearer ...` header to
  // its Prom client when set. Env-only handoff (vs an argv flag) keeps the
  // token off the kubelet command line, matches the OPENAI_API_KEY shape
  // above, and lets older probe.py builds stay backward-compatible — they
  // simply ignore the var when no auth is needed.
  if (connection.prometheusDatasource.bearerToken) {
    secretEnv.PROM_BEARER_TOKEN = connection.prometheusDatasource.bearerToken;
  }

  return {
    argv,
    env: {},
    secretEnv,
    outputFiles: {
      result: "result.json",
    },
  };
}

export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const buf = files.result;
  if (!buf) {
    throw new Error("prefix-cache-probe.parseFinalReport: missing 'result' output file");
  }
  const data = prefixCacheProbeReportSchema.parse(JSON.parse(buf.toString("utf8")));
  return { tool: "prefix-cache-probe", data };
}

export function getMaxDurationSeconds(params: PrefixCacheProbeParams): number {
  // Each round = (requests × ~5s/request) + Prom backoff.
  // +60s buffer for Prometheus query latency and result.json write.
  return params.promptSets * (params.requestsPerSet * 5 + params.promBackoffSec) + 60;
}
