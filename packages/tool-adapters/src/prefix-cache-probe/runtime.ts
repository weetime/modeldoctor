import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import {
  type PrefixCacheProbeParams,
  prefixCacheProbeReportSchema,
} from "./schema.js";

export function buildCommand(
  plan: BuildCommandPlan<PrefixCacheProbeParams>,
): BuildCommandResult {
  const { params, connection } = plan;
  if (!connection.prometheusUrl) {
    throw new Error(
      "prefix-cache-probe requires connection.prometheusUrl to be configured",
    );
  }

  // Argv passes user-supplied strings (baseUrl, prometheusUrl, model) as
  // separate argv entries — Python argparse doesn't shell-expand them, so
  // there's no injection surface (unlike the genai-perf shell wrapper).
  const argv = [
    "python",
    "/app/probe.py",
    "--url",
    connection.baseUrl,
    "--prom",
    connection.prometheusUrl,
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

export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

export function parseFinalReport(
  _stdout: string,
  files: Record<string, Buffer>,
): ToolReport {
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
