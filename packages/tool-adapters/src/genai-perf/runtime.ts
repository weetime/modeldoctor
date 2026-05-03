import { z } from "zod";
import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type GenaiPerfParams, type GenaiPerfReport, genaiPerfReportSchema } from "./schema.js";

// ── Raw shape from genai-perf's JsonExporter ─────────────────────────────────
// Two upstream naming quirks require attention:
//   1. The output file: JsonExporter.export() appends "_genai_perf" to the
//      basename, so "--profile-export-file profile_export.json" actually writes
//      "profile_export_genai_perf.json". We declare this suffix-augmented name
//      in outputFiles and in the shell find-and-copy step.
//   2. The stddev key: Statistics._calculate_std stores the value under "std",
//      not "stddev". Our typed schema keeps the more-readable name "stddev";
//      only the mapper below reads "std" from the raw JSON.

const rawDistSchema = z.object({
  avg: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  p50: z.number().optional(),
  p90: z.number().optional(),
  p95: z.number().optional(),
  p99: z.number().optional(),
  std: z.number().optional(),
  unit: z.string().optional(),
});

const rawThroughputSchema = z.object({
  avg: z.number(),
  unit: z.string().optional(),
});

const rawOutputSchema = z.object({
  request_throughput: rawThroughputSchema,
  request_latency: rawDistSchema,
  time_to_first_token: rawDistSchema,
  inter_token_latency: rawDistSchema,
  output_token_throughput: rawThroughputSchema,
  output_sequence_length: rawDistSchema,
  input_sequence_length: rawDistSchema,
});

// ── buildCommand ──────────────────────────────────────────────────────────────

export function buildCommand(plan: BuildCommandPlan<GenaiPerfParams>): BuildCommandResult {
  const { params, connection } = plan;

  // Build the shell script. User-supplied strings (model, baseUrl, etc.) are
  // passed as positional arguments ($1, $2, …) — not inlined — so they cannot
  // inject shell metacharacters regardless of content.
  //
  // Optional token-length flags are added conditionally here on the JS side
  // (cleaner than runtime shell conditionals) but values still arrive via
  // positional args to preserve the injection safety guarantee.

  let optionalTokenFlags = "";
  const optionalArgv: string[] = [];
  let nextPos = 7; // $1-$6 are the six mandatory args; optional start at $7

  if (params.inputTokensMean !== undefined) {
    optionalTokenFlags += ` \\\n    --synthetic-input-tokens-mean "$${nextPos}"`;
    optionalArgv.push(String(params.inputTokensMean));
    nextPos++;
  }
  if (params.inputTokensStddev > 0) {
    optionalTokenFlags += ` \\\n    --synthetic-input-tokens-stddev "$${nextPos}"`;
    optionalArgv.push(String(params.inputTokensStddev));
    nextPos++;
  }
  if (params.outputTokensMean !== undefined) {
    optionalTokenFlags += ` \\\n    --output-tokens-mean "$${nextPos}"`;
    optionalArgv.push(String(params.outputTokensMean));
    nextPos++;
  }
  if (params.outputTokensStddev > 0) {
    optionalTokenFlags += ` \\\n    --output-tokens-stddev "$${nextPos}"`;
    optionalArgv.push(String(params.outputTokensStddev));
    nextPos++;
  }

  // Tokenizer: per-run override, then connection-level fallback. Omit flag
  // when neither is set (tool default is to derive from `-m`).
  const resolvedTokenizer = params.tokenizer ?? connection.tokenizerHfId ?? undefined;
  if (resolvedTokenizer) {
    optionalTokenFlags += ` \\\n    --tokenizer "$${nextPos}"`;
    optionalArgv.push(resolvedTokenizer);
    nextPos++;
  }

  // $1 = model, $2 = baseUrl, $3 = endpointType,
  // $4 = numPrompts, $5 = concurrency, $6 = streaming ("true"|"false")
  // Authorization header is built into the shell script with literal
  // `$OPENAI_API_KEY`, so the secret is expanded by `sh` at exec time
  // rather than being baked into the K8s pod spec / wrapper argv. The
  // expanded value WILL appear in the inner genai-perf process argv
  // (and therefore in /proc/<pid>/cmdline / ps for that process); what
  // is protected is the wrapper-level argv, the runner log lines
  // (masked by _redacted), and the K8s Job spec.
  //
  // Threat-model note: the value is expanded inside a double-quoted
  // shell string. If the stored apiKey contained shell metacharacters
  // (`$(...)`, backticks, etc.), the shell would interpret them. This
  // is accepted because the user controls their own connection's apiKey
  // — self-injection has no privilege gain over the pod they already own.
  // Future hardening: route the header through a runner-side argv
  // substitution (analogous to runner/main.py::_inject_api_key_into_backend_kwargs)
  // so no shell expansion is involved. Track as follow-up if needed.
  const script = `set -e
STREAMING=""
if [ "$6" = "true" ]; then STREAMING="--streaming"; fi
genai-perf profile \\
    -m "$1" -u "$2" \\
    --endpoint-type "$3" \\
    --num-prompts "$4" --concurrency "$5" \\
    --header "Authorization: Bearer $OPENAI_API_KEY" \\
    $STREAMING${optionalTokenFlags} \\
    --profile-export-file profile_export.json
find artifacts -name profile_export_genai_perf.json -exec cp {} ./profile_export_genai_perf.json \\; && [ -f ./profile_export_genai_perf.json ]`; // surface "no artifact produced" as a job failure, not a parser failure

  return {
    argv: [
      "/bin/sh",
      "-c",
      script,
      "genai-perf-wrapper", // $0: conventional name slot for sh -c
      connection.model, //      $1
      connection.baseUrl, //    $2
      params.endpointType, //   $3
      String(params.numPrompts), //  $4
      String(params.concurrency), // $5
      params.streaming ? "true" : "false", // $6
      ...optionalArgv, // $7+
    ],
    env: {},
    secretEnv: {
      // genai-perf reads OPENAI_API_KEY for OpenAI-compatible endpoints;
      // never put apiKey in argv so it doesn't leak into ps listings or logs.
      OPENAI_API_KEY: connection.apiKey,
    },
    outputFiles: {
      // Upstream JsonExporter appends "_genai_perf" suffix (Deviation 1 above);
      // the find-and-copy step in the script lifts this file out of the dynamic
      // artifact subdirectory into cwd where the runner can collect it.
      profile: "profile_export_genai_perf.json",
    },
  };
}

// ── parseProgress ─────────────────────────────────────────────────────────────
// genai-perf's progress output format is not yet machine-readable in a stable
// way. Return null for all lines (same stance as vegeta).
export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

// ── parseFinalReport ──────────────────────────────────────────────────────────

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const profileBuf = files.profile;
  if (!profileBuf) {
    throw new Error("genai-perf.parseFinalReport: missing 'profile' output file");
  }
  // Bounded by apps/benchmark-runner/runner/main.py's OUTPUT_FILE_MAX_BYTES
  // = 50 MB cap (PR #75) — files over the cap are skipped before reaching
  // /finish, so this parse is bounded.
  const raw = rawOutputSchema.parse(JSON.parse(profileBuf.toString("utf8")));
  const data = mapGenaiPerfRawToReport(raw);
  genaiPerfReportSchema.parse(data);
  return { tool: "genai-perf", data };
}

// ── internal mapper ───────────────────────────────────────────────────────────
// Mapping notes:
//   - "std" in raw → "stddev" in our typed schema (upstream uses abbreviated key)
//   - Fields not present in dimensionless sequence-length metrics (no "unit")
//     are given sensible defaults.

type RawOutput = z.infer<typeof rawOutputSchema>;
type RawDist = z.infer<typeof rawDistSchema>;

function dist(o: RawDist): GenaiPerfReport["requestLatency"] {
  return {
    avg: o.avg,
    min: o.min ?? 0,
    max: o.max ?? 0,
    p50: o.p50 ?? 0,
    p90: o.p90 ?? 0,
    p95: o.p95 ?? 0,
    p99: o.p99 ?? 0,
    // Upstream Statistics._calculate_std writes the key as "std" (not "stddev").
    // Our schema uses the more readable "stddev" name; we bridge here.
    stddev: o.std ?? 0,
    unit: o.unit ?? "",
  };
}

function mapGenaiPerfRawToReport(raw: RawOutput): GenaiPerfReport {
  return {
    requestThroughput: {
      avg: raw.request_throughput.avg,
      unit: raw.request_throughput.unit ?? "requests/sec",
    },
    requestLatency: dist(raw.request_latency),
    timeToFirstToken: dist(raw.time_to_first_token),
    interTokenLatency: dist(raw.inter_token_latency),
    outputTokenThroughput: {
      avg: raw.output_token_throughput.avg,
      unit: raw.output_token_throughput.unit ?? "tokens/sec",
    },
    outputSequenceLength: {
      avg: raw.output_sequence_length.avg,
      p50: raw.output_sequence_length.p50 ?? 0,
      p99: raw.output_sequence_length.p99 ?? 0,
    },
    inputSequenceLength: {
      avg: raw.input_sequence_length.avg,
      p50: raw.input_sequence_length.p50 ?? 0,
      p99: raw.input_sequence_length.p99 ?? 0,
    },
  };
}

// ── getMaxDurationSeconds ─────────────────────────────────────────────────────
// genai-perf runs numPrompts requests with `concurrency` workers and has no
// duration flag. Without a hard time bound, return a generous estimate that
// scales with load.
export function getMaxDurationSeconds(params: GenaiPerfParams): number {
  // Conservative upper bound assuming up to ~10s per request batch:
  // total runtime ≈ ceil(numPrompts / concurrency) batches × 10s.
  // Floor at 60s for very small runs against fast targets; this drives
  // the HMAC TTL on the run callback, so being a little long is fine
  // (a tighter cap would just risk false 401s on slow targets).
  const batches = Math.ceil(params.numPrompts / Math.max(1, params.concurrency));
  return Math.max(60, batches * 10);
}
