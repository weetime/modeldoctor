import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type AiperfParams, aiperfReportSchema } from "./schema.js";

const OUTPUTS_DIR = "out";
const SUMMARY_FILE = "profile_export_aiperf.json";

// aiperf reads the endpoint API key ONLY from --api-key (no env-var channel;
// OPENAI_API_KEY in secretEnv alone never reaches the requests — Higress-style
// authed gateways then 401 every request). Same sentinel contract as
// evalscope: the runner swaps it for OPENAI_API_KEY right before Popen and
// masks the value after --api-key in logs.
// Contract: apps/benchmark-runner/runner/main.py::OPENAI_API_KEY_SENTINEL.
const OPENAI_API_KEY_SENTINEL = "__MD_OPENAI_API_KEY__";

export function buildCommand(plan: BuildCommandPlan<AiperfParams>): BuildCommandResult {
  const { params, connection } = plan;
  const trimmedBase = connection.baseUrl.replace(/\/+$/, "");

  const argv: string[] = [
    "aiperf",
    "profile",
    "--model",
    connection.model,
    "--url",
    trimmedBase,
    "--endpoint-type",
    params.endpointType,
  ];

  // AIPerf needs a real HF tokenizer for synthetic prompt generation AND
  // client-side token counting. connection.model is frequently a served name
  // (e.g. gen-studio_*) that 401s against huggingface.co, so pass the
  // connection-level tokenizerHfId when set. Without it AIPerf aborts with
  // "Failed to load tokenizer '<model>'". Mirrors guidellm's --processor.
  if (connection.tokenizerHfId) argv.push("--tokenizer", connection.tokenizerHfId);

  // Sentinel — runner replaces with OPENAI_API_KEY at exec time (see above).
  if (connection.apiKey) argv.push("--api-key", OPENAI_API_KEY_SENTINEL);

  // aiperf sizes its worker pool from the HOST cpu count (cgroup-blind), so
  // inside the 2-CPU runner limit it overspawns and the multiprocess service
  // registration times out ("Service timing_manager failed to register").
  // Cap workers to fit the runner cgroup; each worker is async and easily
  // drives many concurrent streams.
  argv.push("--workers-max", String(Math.min(params.concurrency, 4)));

  // --streaming is a presence-only boolean toggle (no --no-streaming form).
  // Streaming off = simply omit the flag.
  if (params.streaming) argv.push("--streaming");

  if (params.dataset === "mooncake-trace") {
    // Open-loop trace replay. Concurrency is ignored; aiperf paces by the
    // trace's own timestamps via --fixed-schedule.
    if (!params.mooncakeTrace) {
      throw new Error("aiperf mooncake-trace requires mooncakeTrace (conversation | toolagent)");
    }
    const file = `/app/.cache/aiperf/datasets/mooncake/${params.mooncakeTrace}_trace.jsonl`;
    argv.push("--input-file", file, "--custom-dataset-type", "mooncake_trace", "--fixed-schedule");
    if (params.islBlockSize !== undefined) {
      argv.push("--isl-block-size", String(params.islBlockSize));
    }
  } else {
    // Closed-loop synthetic / sharegpt.
    argv.push("--concurrency", String(params.concurrency));
    // aiperf rejects --request-count combined with --conversation-num
    // (UserConfig validation). In multi-turn mode the workload size is
    // conversationNum × conversationTurnMean; requestCount only drives
    // the single-turn path (and our wall-clock estimate).
    if (params.conversationNum === undefined) {
      argv.push("--request-count", String(params.requestCount));
    }
    argv.push(
      "--synthetic-input-tokens-mean",
      String(params.inputTokensMean),
      "--synthetic-input-tokens-stddev",
      String(params.inputTokensStddev),
      "--output-tokens-mean",
      String(params.outputTokensMean),
      "--output-tokens-stddev",
      String(params.outputTokensStddev),
    );
    // dataset=synthetic = AIPerf's default generator (no --public-dataset);
    // dataset=sharegpt = opt into the downloaded ShareGPT corpus.
    if (params.dataset === "sharegpt") argv.push("--public-dataset", "sharegpt");

    if (params.conversationNum !== undefined) {
      argv.push("--conversation-num", String(params.conversationNum));
    }
    if (params.conversationTurnMean !== undefined) {
      argv.push("--conversation-turn-mean", String(params.conversationTurnMean));
    }
    if (params.conversationTurnStddev !== undefined) {
      argv.push("--conversation-turn-stddev", String(params.conversationTurnStddev));
    }
    if (params.conversationType !== undefined) {
      // aiperf has no --conversation-type; sticky routing is controlled by the
      // transport-level --connection-reuse-strategy (pooled | never |
      // sticky-user-sessions), which is what our conversationType maps to.
      argv.push("--connection-reuse-strategy", params.conversationType);
    }
    if (params.conversationTurnDelayMeanMs !== undefined) {
      argv.push("--conversation-turn-delay-mean", String(params.conversationTurnDelayMeanMs));
    }
  }

  if (params.seed !== undefined) argv.push("--random-seed", String(params.seed));

  argv.push("--artifact-dir", OUTPUTS_DIR);

  return {
    argv,
    env: {},
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    // AIPerf writes <artifact-dir>/profile_export_aiperf.json for the
    // summary export (`--profile-export-prefix` defaults to "profile_export_aiperf").
    outputFiles: { report: `${OUTPUTS_DIR}/${SUMMARY_FILE}` },
  };
}

// AIPerf renders a Rich TUI dashboard on stderr; not stable for
// line-by-line parsing. Rely on the final JSON.
export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

// One slice of profile_export_aiperf.json (matches aiperf's
// JsonMetricResult pydantic model in aiperf/common/models/export_models.py).
interface JsonMetricResult {
  unit: string;
  avg?: number;
  p1?: number;
  p5?: number;
  p10?: number;
  p25?: number;
  p50?: number;
  p75?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  min?: number;
  max?: number;
  std?: number;
}

// Top-level shape of profile_export_aiperf.json (matches JsonExportData).
interface AiperfRawReport {
  schema_version?: string;
  aiperf_version?: string;
  benchmark_id?: string;
  request_throughput?: JsonMetricResult;
  request_latency?: JsonMetricResult;
  time_to_first_token?: JsonMetricResult;
  inter_token_latency?: JsonMetricResult;
  output_token_throughput?: JsonMetricResult;
  output_sequence_length?: JsonMetricResult;
  input_sequence_length?: JsonMetricResult;
  request_count?: JsonMetricResult;
  error_request_count?: JsonMetricResult;
  benchmark_duration?: JsonMetricResult;
}

function readDist(m: JsonMetricResult | undefined) {
  return {
    mean: m?.avg ?? 0,
    p50: m?.p50 ?? 0,
    p90: m?.p90 ?? 0,
    p95: m?.p95 ?? 0,
    p99: m?.p99 ?? 0,
  };
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const buf = files.report;
  if (!buf) {
    throw new Error("aiperf.parseFinalReport: missing 'report' output file");
  }
  const raw = JSON.parse(buf.toString("utf8")) as AiperfRawReport;

  // Request counts: aiperf reports them as JsonMetricResult shapes too
  // (avg = total count). error_request_count.avg holds the failure count.
  const total = Math.round(raw.request_count?.avg ?? 0);
  const failed = Math.round(raw.error_request_count?.avg ?? 0);
  const success = Math.max(0, total - failed);
  const errorRate = total === 0 ? 0 : failed / total;

  const outputTps = raw.output_token_throughput?.avg ?? 0;
  const reqsPerSec = raw.request_throughput?.avg ?? 0;
  const avgIsl = raw.input_sequence_length?.avg ?? 0;
  // totalTokensPerSec is not surfaced as a top-level metric in
  // profile_export_aiperf.json; derive: (avg ISL × reqs/s) + outputTokensPerSec.
  const inputTps = avgIsl * reqsPerSec;
  const totalTps = inputTps + outputTps;

  const data = {
    throughput: {
      requestsPerSec: reqsPerSec,
      outputTokensPerSec: outputTps,
      totalTokensPerSec: totalTps,
    },
    ttft: readDist(raw.time_to_first_token),
    e2eLatency: readDist(raw.request_latency),
    itl: readDist(raw.inter_token_latency),
    requests: { total, success, error: failed, errorRate },
  };

  return { tool: "aiperf", data: aiperfReportSchema.parse(data) };
}

export function getMaxDurationSeconds(params: AiperfParams): number {
  // Worst case ~10s/request at concurrency 1 (long output + cold cache).
  // Apply the standard ~120s runner buffer.
  const perReqWorst = 10;
  // Multi-turn mode ignores requestCount (buildCommand omits --request-count);
  // the effective workload is conversationNum × conversationTurnMean (aiperf
  // defaults a missing turn mean to 1). Per-turn think-time delays are
  // sequential within a conversation, so they add to per-request wall time.
  const effectiveRequests =
    params.conversationNum !== undefined
      ? params.conversationNum * (params.conversationTurnMean ?? 1)
      : params.requestCount;
  const perReq = perReqWorst + (params.conversationTurnDelayMeanMs ?? 0) / 1000;
  const wall = Math.ceil((effectiveRequests * perReq) / Math.max(1, params.concurrency));
  return Math.max(120, Math.min(3600, wall + 120));
}
