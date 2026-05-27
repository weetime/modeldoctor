import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type EvalscopeParams, evalscopeReportSchema } from "./schema.js";

// LongAlpaca-12k + HC3-Chinese (openqa) are baked into the evalscope runner
// image at build time (apps/benchmark-runner/images/evalscope.Dockerfile)
// so air-gapped clusters never hit modelscope.cn at run time. `random` is
// fully synthetic and needs no dataset path.
const BAKED_DATASET_PATHS: Record<string, string> = {
  longalpaca: "/opt/evalscope-datasets/longalpaca",
  openqa: "/opt/evalscope-datasets/openqa/open_qa.jsonl",
};

const OUTPUTS_DIR = "out";
const RUN_NAME = "evalscope-run";

// evalscope `perf` reads the API key ONLY from --api-key (it ignores env vars),
// so unlike aiperf (env) / guidellm (--backend-kwargs) the key must travel in
// argv. To keep the secret out of the K8s Job manifest / MD_ARGV we emit this
// sentinel; the runner swaps in OPENAI_API_KEY (secretEnv, per-run Secret) at
// exec time. Contract: apps/benchmark-runner/runner/main.py::OPENAI_API_KEY_SENTINEL.
const OPENAI_API_KEY_SENTINEL = "__MD_OPENAI_API_KEY__";

export function buildCommand(plan: BuildCommandPlan<EvalscopeParams>): BuildCommandResult {
  const { params, connection } = plan;
  const trimmedBase = connection.baseUrl.replace(/\/+$/, "");

  // evalscope's `--url` takes the FULL endpoint URL (incl. /v1/...path); `--api` is
  // the backend type identifier ("openai" for chat/completions and completions).
  const fullUrl = `${trimmedBase}${params.apiPath}`;

  const argv: string[] = [
    "evalscope",
    "perf",
    "--url",
    fullUrl,
    "--api",
    "openai",
    "--model",
    connection.model,
    // Sentinel — runner replaces with OPENAI_API_KEY at exec time (see above).
    "--api-key",
    OPENAI_API_KEY_SENTINEL,
    "--parallel",
    String(params.parallel),
    "--number",
    String(params.number),
    "--dataset",
    params.dataset,
  ];

  const datasetPath = BAKED_DATASET_PATHS[params.dataset];
  if (datasetPath) argv.push("--dataset-path", datasetPath);

  argv.push(
    "--min-prompt-length",
    String(params.minPromptLength),
    "--max-prompt-length",
    String(params.maxPromptLength),
    "--min-tokens",
    String(params.minTokens),
    "--max-tokens",
    String(params.maxTokens),
  );

  if (params.seed !== undefined) argv.push("--seed", String(params.seed));

  // --stream / --no-stream is a binary toggle (argparse BooleanOptionalAction).
  // Always emit one or the other so the runtime is explicit about which mode.
  argv.push(params.stream ? "--stream" : "--no-stream");

  // --outputs-dir + --no-timestamp + --name pin a stable output path:
  //   <OUTPUTS_DIR>/<RUN_NAME>/benchmark_summary.json
  //   <OUTPUTS_DIR>/<RUN_NAME>/benchmark_percentile.json
  // Without --no-timestamp, evalscope inserts a YYYYMMDD_HHMMSS directory.
  argv.push("--outputs-dir", OUTPUTS_DIR, "--no-timestamp", "--name", RUN_NAME);

  return {
    argv,
    env: {},
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    outputFiles: {
      summary: `${OUTPUTS_DIR}/${RUN_NAME}/benchmark_summary.json`,
      percentile: `${OUTPUTS_DIR}/${RUN_NAME}/benchmark_percentile.json`,
    },
  };
}

// evalscope emits Rich-style live progress to stderr (carriage-return
// updates). The terminal-friendly format isn't stable for line-by-line
// parsing; rely on the final files instead.
export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

// Canonical keys in evalscope's benchmark_summary.json (see
// `evalscope/perf/utils/perf_constants.py::Metrics`). evalscope uses
// human-friendly key strings with units in them — we read the labels
// verbatim and normalize into our schema's units.
interface EvalscopeSummary {
  "Test Duration (s)"?: number;
  Concurrency?: number;
  "Request Rate (req/s)"?: number;
  "Total Requests"?: number;
  "Success Requests"?: number;
  "Failed Requests"?: number;
  "Req Throughput (req/s)"?: number;
  "Avg Latency (s)"?: number;
  "Avg Input Tokens"?: number;
  "Output Throughput (tok/s)"?: number;
  "Total Throughput (tok/s)"?: number;
  "TTFT (ms)"?: number;
  "TPOT (ms)"?: number;
  "ITL (ms)"?: number;
  "Avg Output Tokens"?: number;
  "KV Cache Hit Rate (%)"?: number;
}

// Each row in benchmark_percentile.json is one percentile bucket.
interface EvalscopePercentileRow {
  Percentiles: string; // "50%", "90%", etc.
  "TTFT (ms)"?: number;
  "ITL (ms)"?: number;
  "TPOT (ms)"?: number;
  "Latency (s)"?: number;
  "Input tokens"?: number;
  "Output tokens"?: number;
}

function findPercentile(rows: EvalscopePercentileRow[], pct: "50%" | "90%" | "95%" | "99%") {
  return rows.find((r) => r.Percentiles === pct);
}

function readDist(rows: EvalscopePercentileRow[], field: "TTFT (ms)" | "ITL (ms)", mean: number) {
  return {
    mean,
    p50: findPercentile(rows, "50%")?.[field] ?? 0,
    p90: findPercentile(rows, "90%")?.[field] ?? 0,
    p95: findPercentile(rows, "95%")?.[field] ?? 0,
    p99: findPercentile(rows, "99%")?.[field] ?? 0,
  };
}

function readLatencyDist(rows: EvalscopePercentileRow[], meanSec: number) {
  // Percentile rows store Latency in SECONDS; we normalize to ms to match
  // the rest of the report (TTFT/ITL are already ms-native).
  const meanMs = meanSec * 1000;
  const inMs = (sec: number | undefined) => (sec === undefined ? 0 : sec * 1000);
  return {
    mean: meanMs,
    p50: inMs(findPercentile(rows, "50%")?.["Latency (s)"]),
    p90: inMs(findPercentile(rows, "90%")?.["Latency (s)"]),
    p95: inMs(findPercentile(rows, "95%")?.["Latency (s)"]),
    p99: inMs(findPercentile(rows, "99%")?.["Latency (s)"]),
  };
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const summaryBuf = files.summary;
  if (!summaryBuf) {
    throw new Error("evalscope.parseFinalReport: missing 'summary' output file");
  }
  const percentileBuf = files.percentile;
  if (!percentileBuf) {
    throw new Error("evalscope.parseFinalReport: missing 'percentile' output file");
  }

  const summary = JSON.parse(summaryBuf.toString("utf8")) as EvalscopeSummary;
  const percentile = JSON.parse(percentileBuf.toString("utf8")) as EvalscopePercentileRow[];

  const total = summary["Total Requests"] ?? 0;
  const success = summary["Success Requests"] ?? total;
  const failed = summary["Failed Requests"] ?? Math.max(0, total - success);
  const errorRate = total === 0 ? 0 : failed / total;

  const hitPct = summary["KV Cache Hit Rate (%)"];
  const prefixCacheStats =
    hitPct !== undefined ? { hitRate: Math.max(0, Math.min(1, hitPct / 100)) } : undefined;

  const data = {
    throughput: {
      requestsPerSec: summary["Req Throughput (req/s)"] ?? 0,
      outputTokensPerSec: summary["Output Throughput (tok/s)"] ?? 0,
      totalTokensPerSec: summary["Total Throughput (tok/s)"] ?? 0,
    },
    ttft: readDist(percentile, "TTFT (ms)", summary["TTFT (ms)"] ?? 0),
    e2eLatency: readLatencyDist(percentile, summary["Avg Latency (s)"] ?? 0),
    itl: readDist(percentile, "ITL (ms)", summary["ITL (ms)"] ?? 0),
    requests: {
      total,
      success,
      error: failed,
      errorRate,
    },
    ...(prefixCacheStats ? { prefixCacheStats } : {}),
  };

  return { tool: "evalscope", data: evalscopeReportSchema.parse(data) };
}

export function getMaxDurationSeconds(params: EvalscopeParams): number {
  // Conservative wall-clock estimate. Worst case: long prompts + cold cache
  // ≈ 30s/request at parallel 1. The runner-supplied buffer (~120s) is
  // already standard. Tighten with measured data once collected.
  const perReqWorst = 30; // sec
  const wallClock = Math.ceil((params.number * perReqWorst) / Math.max(1, params.parallel));
  return Math.max(120, Math.min(3600, wallClock + 120));
}
