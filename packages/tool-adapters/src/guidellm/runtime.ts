import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type GuidellmParams, type GuidellmReport, guidellmReportSchema } from "./schema.js";

export function buildCommand(plan: BuildCommandPlan<GuidellmParams>): BuildCommandResult {
  const { params, connection } = plan;

  if (params.datasetName === "sharegpt") {
    throw new Error("sharegpt dataset is not yet supported");
  }

  // --backend-kwargs is guidellm's only channel for api_key. We always emit
  // this flag (even with an empty object) so the runner wrapper can merge
  // {"api_key": $OPENAI_API_KEY} into it at exec time. Keeping api_key out
  // of argv prevents leaks via `ps` / process listings.
  // Contract: see runner/main.py::_inject_api_key_into_backend_kwargs.
  const backendKwargs: Record<string, unknown> = {};
  if (!params.validateBackend) {
    backendKwargs.validate_backend = false;
  }

  const argv: string[] = [
    "guidellm",
    "benchmark",
    "run",
    "--backend=openai_http",
    `--target=${connection.baseUrl}`,
    `--model=${connection.model}`,
    `--max-requests=${params.totalRequests}`,
    `--max-seconds=${params.maxDurationSeconds}`,
    "--output-path=report.json",
    "--disable-console",
  ];

  // Always emit --backend-kwargs= (even {}) — the runner merges api_key into it.
  argv.push(`--backend-kwargs=${JSON.stringify(backendKwargs)}`);

  if (params.requestRate > 0) {
    argv.push("--rate-type=constant", `--rate=${params.requestRate}`);
  } else {
    argv.push("--rate-type=throughput", `--rate=${params.maxConcurrency}`);
  }

  argv.push(
    `--data=prompt_tokens=${params.datasetInputTokens},output_tokens=${params.datasetOutputTokens}`,
  );
  if (params.datasetSeed !== undefined) {
    argv.push(`--random-seed=${params.datasetSeed}`);
  }
  // Per-run `processor` overrides; otherwise fall back to the connection-
  // level tokenizer; otherwise omit the flag (tool defaults to using
  // connection.model which fails for non-HF model names).
  const processor = params.processor || connection.tokenizerHfId || undefined;
  if (processor) {
    argv.push(`--processor=${processor}`);
  }

  return {
    argv,
    env: {},
    secretEnv: {
      // api_key is injected into --backend-kwargs by the runner wrapper at exec
      // time (runner/main.py::_inject_api_key_into_backend_kwargs). Passing it
      // via secretEnv keeps it out of argv and ps listings until the wrapper
      // merges it immediately before Popen.
      OPENAI_API_KEY: connection.apiKey,
    },
    outputFiles: { report: "report.json" },
  };
}

// guidellm with --disable-console emits no progress lines on stderr.
// If a future version emits machine-readable lines, parse here.
export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const reportBuf = files.report;
  if (!reportBuf) {
    throw new Error("guidellm.parseFinalReport: missing 'report' output file");
  }
  const raw = JSON.parse(reportBuf.toString("utf8")) as Record<string, unknown>;
  const data = mapGuidellmRawToReport(raw);
  guidellmReportSchema.parse(data);
  return { tool: "guidellm", data };
}

// ── internal mapper (port of apps/benchmark-runner/runner/metrics.py) ──
function successful(metrics: Record<string, unknown>, key: string): Record<string, unknown> {
  const sds = (metrics[key] ?? {}) as Record<string, unknown>;
  return (sds.successful as Record<string, unknown>) ?? {};
}
function latency(
  metrics: Record<string, unknown>,
  key: string,
): {
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
} {
  const src = successful(metrics, key);
  const pct = (src.percentiles as Record<string, unknown>) ?? {};
  return {
    mean: Number(src.mean ?? 0),
    p50: Number(pct.p50 ?? src.median ?? 0),
    p90: Number(pct.p90 ?? 0),
    p95: Number(pct.p95 ?? 0),
    p99: Number(pct.p99 ?? 0),
  };
}
function rate(metrics: Record<string, unknown>, key: string): { mean: number } {
  return { mean: Number(successful(metrics, key).mean ?? 0) };
}

function mapGuidellmRawToReport(raw: Record<string, unknown>): GuidellmReport {
  const benches = (raw.benchmarks as Array<Record<string, unknown>> | undefined) ?? [];
  const first = benches[0] ?? {};
  const metrics = (first.metrics as Record<string, unknown> | undefined) ?? {};

  const concurrencySrc = successful(metrics, "request_concurrency");
  const totals = (metrics.request_totals as Record<string, unknown> | undefined) ?? {};

  // request_latency in guidellm 0.5.x is in seconds (no _ms suffix in key);
  // convert to milliseconds for the wire shape.
  const e2e = latency(metrics, "request_latency");
  const e2eMs = {
    mean: e2e.mean * 1000,
    p50: e2e.p50 * 1000,
    p90: e2e.p90 * 1000,
    p95: e2e.p95 * 1000,
    p99: e2e.p99 * 1000,
  };

  return {
    ttft: latency(metrics, "time_to_first_token_ms"),
    itl: latency(metrics, "inter_token_latency_ms"),
    e2eLatency: e2eMs,
    requests: {
      total: Number(totals.total ?? 0) | 0,
      success: Number(totals.successful ?? 0) | 0,
      error: Number(totals.errored ?? 0) | 0,
      incomplete: Number(totals.incomplete ?? 0) | 0,
    },
    requestsPerSecond: rate(metrics, "requests_per_second"),
    outputTokensPerSecond: rate(metrics, "output_tokens_per_second"),
    inputTokensPerSecond: rate(metrics, "prompt_tokens_per_second"),
    totalTokensPerSecond: rate(metrics, "tokens_per_second"),
    concurrency: {
      mean: Number(concurrencySrc.mean ?? 0),
      max: Number(concurrencySrc.max ?? 0),
    },
  };
}

export function getMaxDurationSeconds(params: GuidellmParams): number {
  return params.maxDurationSeconds;
}
