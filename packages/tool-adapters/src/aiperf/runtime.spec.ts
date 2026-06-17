import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExtraArgsError } from "../core/extra-args.js";
import type { BuildCommandPlan } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import type { AiperfParams } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (n: string) => join(__dirname, "__fixtures__", n);

const baseParams: AiperfParams = {
  concurrency: 8,
  requestCount: 100,
  inputTokensMean: 1024,
  inputTokensStddev: 128,
  outputTokensMean: 256,
  outputTokensStddev: 64,
  endpointType: "chat",
  streaming: true,
  dataset: "synthetic",
  seed: 42,
};

const plan: BuildCommandPlan<AiperfParams> = {
  runId: "r1",
  params: baseParams,
  connection: {
    baseUrl: "http://10.0.0.5:8000",
    apiKey: "sk-test",
    model: "Qwen2.5-7B-Instruct",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: null,
    prometheusDatasource: null,
  },
};

describe("aiperf.buildCommand", () => {
  it("emits the expected aiperf profile argv with streaming + synthetic + seed", () => {
    const r = buildCommand(plan);
    expect(r.argv).toEqual([
      "aiperf",
      "profile",
      "--model",
      "Qwen2.5-7B-Instruct",
      "--url",
      "http://10.0.0.5:8000",
      "--endpoint-type",
      "chat",
      "--api-key",
      "__MD_OPENAI_API_KEY__",
      "--workers-max",
      "4",
      "--streaming",
      "--concurrency",
      "8",
      "--request-count",
      "100",
      "--synthetic-input-tokens-mean",
      "1024",
      "--synthetic-input-tokens-stddev",
      "128",
      "--output-tokens-mean",
      "256",
      "--output-tokens-stddev",
      "64",
      "--random-seed",
      "42",
      "--artifact-dir",
      "out",
    ]);
    expect(r.secretEnv?.OPENAI_API_KEY).toBe("sk-test");
    // The raw key must never appear in argv — only the runner-side sentinel.
    expect(r.argv).not.toContain("sk-test");
  });

  it("omits --api-key when connection.apiKey is empty", () => {
    const r = buildCommand({
      ...plan,
      connection: { ...plan.connection, apiKey: "" },
    });
    expect(r.argv).not.toContain("--api-key");
  });

  it("omits --streaming when streaming=false", () => {
    const r = buildCommand({
      ...plan,
      params: { ...baseParams, streaming: false },
    });
    expect(r.argv).not.toContain("--streaming");
  });

  it("appends --public-dataset sharegpt when dataset=sharegpt", () => {
    const r = buildCommand({
      ...plan,
      params: { ...baseParams, dataset: "sharegpt" },
    });
    expect(r.argv).toContain("--public-dataset");
    expect(r.argv).toContain("sharegpt");
  });

  it("omits --public-dataset when dataset=synthetic (the default generator)", () => {
    const r = buildCommand(plan);
    expect(r.argv).not.toContain("--public-dataset");
  });

  it("emits --tokenizer when connection.tokenizerHfId is set", () => {
    const r = buildCommand({
      ...plan,
      connection: { ...plan.connection, tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct" },
    });
    const idx = r.argv.indexOf("--tokenizer");
    expect(idx).toBeGreaterThan(-1);
    expect(r.argv[idx + 1]).toBe("Qwen/Qwen2.5-0.5B-Instruct");
  });

  it("omits --tokenizer when connection.tokenizerHfId is null", () => {
    const r = buildCommand(plan);
    expect(r.argv).not.toContain("--tokenizer");
  });

  it("omits --random-seed when seed is not set", () => {
    const r = buildCommand({
      ...plan,
      params: { ...baseParams, seed: undefined },
    });
    expect(r.argv).not.toContain("--random-seed");
  });

  it("uses endpoint-type completions when configured", () => {
    const r = buildCommand({
      ...plan,
      params: { ...baseParams, endpointType: "completions" },
    });
    const idx = r.argv.indexOf("--endpoint-type");
    expect(r.argv[idx + 1]).toBe("completions");
  });

  it("strips trailing slashes from connection.baseUrl", () => {
    const r = buildCommand({
      ...plan,
      connection: { ...plan.connection, baseUrl: "http://10.0.0.5:8000///" },
    });
    const idx = r.argv.indexOf("--url");
    expect(r.argv[idx + 1]).toBe("http://10.0.0.5:8000");
  });

  it("declares the summary output file at out/profile_export_aiperf.json", () => {
    const r = buildCommand(plan);
    expect(r.outputFiles).toEqual({
      report: "out/profile_export_aiperf.json",
    });
  });

  const conn = {
    baseUrl: "http://gw:30888",
    apiKey: "sk-x",
    model: "served-name",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: "Qwen/Qwen2.5-7B-Instruct",
    prometheusDatasource: null,
  };

  it("synthetic multi-turn → closed-loop concurrency + conversation flags", () => {
    const r = buildCommand({
      runId: "r1",
      params: {
        concurrency: 20,
        requestCount: 300,
        inputTokensMean: 200,
        inputTokensStddev: 0,
        outputTokensMean: 800,
        outputTokensStddev: 0,
        endpointType: "chat",
        streaming: true,
        dataset: "synthetic",
        conversationNum: 30,
        conversationTurnMean: 10,
        conversationType: "sticky-user-sessions",
      },
      connection: conn,
    } as any);
    const flat = r.argv.join(" ");
    expect(flat).toContain("--concurrency 20");
    expect(flat).toContain("--conversation-num 30");
    expect(flat).toContain("--conversation-turn-mean 10");
    expect(flat).toContain("--connection-reuse-strategy sticky-user-sessions");
    expect(flat).not.toContain("--conversation-type");
    // aiperf forbids --request-count alongside --conversation-num.
    expect(flat).not.toContain("--request-count");
    expect(flat).not.toContain("--fixed-schedule");
  });

  it("throws when mooncake-trace is missing a trace selection", () => {
    expect(() =>
      buildCommand({
        runId: "r3",
        params: {
          concurrency: 20,
          requestCount: 300,
          inputTokensMean: 200,
          inputTokensStddev: 0,
          outputTokensMean: 800,
          outputTokensStddev: 0,
          endpointType: "chat",
          streaming: true,
          dataset: "mooncake-trace",
        },
        connection: conn,
      } as any),
    ).toThrow(/mooncakeTrace/);
  });

  it("mooncake-trace → open-loop fixed-schedule, no concurrency", () => {
    const r = buildCommand({
      runId: "r2",
      params: {
        concurrency: 20,
        requestCount: 300,
        inputTokensMean: 200,
        inputTokensStddev: 0,
        outputTokensMean: 800,
        outputTokensStddev: 0,
        endpointType: "chat",
        streaming: true,
        dataset: "mooncake-trace",
        mooncakeTrace: "conversation",
      },
      connection: conn,
    } as any);
    const flat = r.argv.join(" ");
    expect(flat).toContain(
      "--input-file /app/.cache/aiperf/datasets/mooncake/conversation_trace.jsonl",
    );
    expect(flat).toContain("--custom-dataset-type mooncake_trace");
    // synthetic-only flag must never leak into trace replay (aiperf ≥0.10 aborts)
    expect(flat).not.toContain("--isl-block-size");
    expect(flat).toContain("--fixed-schedule");
    expect(flat).not.toContain("--concurrency");
    expect(flat).not.toContain("--synthetic-input-tokens-mean");
    // unbounded by default — no end-offset unless a window is set
    expect(flat).not.toContain("--fixed-schedule-end-offset");
  });

  it("mooncake-trace with a replay window → --fixed-schedule-end-offset in ms", () => {
    const r = buildCommand({
      runId: "r2b",
      params: {
        concurrency: 20,
        requestCount: 300,
        inputTokensMean: 200,
        inputTokensStddev: 0,
        outputTokensMean: 800,
        outputTokensStddev: 0,
        endpointType: "chat",
        streaming: true,
        dataset: "mooncake-trace",
        mooncakeTrace: "conversation",
        traceReplayWindowSec: 300,
      },
      connection: conn,
    } as any);
    expect(r.argv.join(" ")).toContain("--fixed-schedule-end-offset 300000");
  });
});

describe("aiperf.parseFinalReport", () => {
  it("maps profile_export_aiperf.json into a valid AiperfReport", () => {
    const buf = readFileSync(fixturePath("profile_export_aiperf.json"));
    const report = parseFinalReport("", { report: buf });
    expect(report.tool).toBe("aiperf");
    if (report.tool !== "aiperf") throw new Error(`expected aiperf, got ${report.tool}`);

    // throughput from request_throughput + output_token_throughput
    expect(report.data.throughput.requestsPerSec).toBeCloseTo(4.85);
    expect(report.data.throughput.outputTokensPerSec).toBeCloseTo(1230.5);

    // totalTokensPerSec is derived: output + input (avg ISL * req/s)
    expect(report.data.throughput.totalTokensPerSec).toBeGreaterThan(
      report.data.throughput.outputTokensPerSec,
    );

    // ttft from time_to_first_token
    expect(report.data.ttft.mean).toBeCloseTo(287.4);
    expect(report.data.ttft.p50).toBeCloseTo(278.7);
    expect(report.data.ttft.p99).toBeCloseTo(521.8);

    // itl from inter_token_latency
    expect(report.data.itl.mean).toBeCloseTo(26.8);
    expect(report.data.itl.p95).toBeCloseTo(34.8);

    // e2e from request_latency
    expect(report.data.e2eLatency.mean).toBeCloseTo(1647.3);
    expect(report.data.e2eLatency.p99).toBeCloseTo(2920.4);

    // requests
    expect(report.data.requests.total).toBe(100);
    expect(report.data.requests.success).toBe(100);
    expect(report.data.requests.error).toBe(0);
    expect(report.data.requests.errorRate).toBe(0);
  });

  it("computes errorRate from error_request_count when present", () => {
    const buf = Buffer.from(
      JSON.stringify({
        request_throughput: { unit: "requests/sec", avg: 4.5 },
        request_latency: { unit: "ms", avg: 1700, p50: 1600, p90: 2200, p95: 2400, p99: 2800 },
        time_to_first_token: { unit: "ms", avg: 300, p50: 280, p90: 400, p95: 450, p99: 550 },
        inter_token_latency: { unit: "ms", avg: 28, p50: 26, p90: 33, p95: 36, p99: 40 },
        output_token_throughput: { unit: "tokens/sec", avg: 1150 },
        output_sequence_length: { unit: "tokens", avg: 256 },
        input_sequence_length: { unit: "tokens", avg: 1020 },
        request_count: { unit: "requests", avg: 100 },
        error_request_count: { unit: "requests", avg: 5 },
      }),
    );
    const report = parseFinalReport("", { report: buf });
    if (report.tool !== "aiperf") throw new Error(`expected aiperf, got ${report.tool}`);
    expect(report.data.requests.total).toBe(100);
    expect(report.data.requests.error).toBe(5);
    expect(report.data.requests.success).toBe(95);
    expect(report.data.requests.errorRate).toBeCloseTo(0.05);
  });

  it("throws when the report file is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow(/missing.*report/);
  });
});

describe("aiperf.parseProgress", () => {
  it("returns null for arbitrary stderr lines", () => {
    expect(parseProgress("noise")).toBeNull();
  });
});

describe("aiperf.getMaxDurationSeconds", () => {
  it("yields a buffered ceiling within bounds", () => {
    expect(getMaxDurationSeconds(baseParams)).toBeGreaterThanOrEqual(120);
    expect(getMaxDurationSeconds(baseParams)).toBeLessThanOrEqual(3600);
  });

  it("scales with requestCount / concurrency", () => {
    const small = getMaxDurationSeconds({ ...baseParams, requestCount: 8 });
    const large = getMaxDurationSeconds({ ...baseParams, requestCount: 1000 });
    expect(large).toBeGreaterThan(small);
  });

  it("multi-turn: sizes by conversationNum × turnMean, ignoring requestCount", () => {
    // requestCount is omitted from argv in multi-turn mode; a low value must
    // not shrink the wall-clock ceiling below the real workload.
    const d = getMaxDurationSeconds({
      ...baseParams,
      requestCount: 10,
      conversationNum: 60,
      conversationTurnMean: 10,
    });
    // 600 effective requests × 10s / concurrency 8 + 120s buffer
    expect(d).toBe(Math.min(3600, Math.ceil((600 * 10) / 8) + 120));
  });

  it("multi-turn: per-turn delays extend the ceiling", () => {
    const noDelay = getMaxDurationSeconds({
      ...baseParams,
      conversationNum: 30,
      conversationTurnMean: 5,
    });
    const withDelay = getMaxDurationSeconds({
      ...baseParams,
      conversationNum: 30,
      conversationTurnMean: 5,
      conversationTurnDelayMeanMs: 2000,
    });
    expect(withDelay).toBeGreaterThan(noDelay);
  });

  it("mooncake: sizes by replay window (send is timestamp-paced), not requestCount", () => {
    const bounded = getMaxDurationSeconds({
      ...baseParams,
      dataset: "mooncake-trace",
      mooncakeTrace: "conversation",
      traceReplayWindowSec: 300,
    } as never);
    expect(bounded).toBe(300 + 600);
    // unbounded full replay falls back to the ~59-min trace span + buffer
    const full = getMaxDurationSeconds({
      ...baseParams,
      dataset: "mooncake-trace",
      mooncakeTrace: "conversation",
    } as never);
    expect(full).toBe(Math.min(7200, 3600 + 600));
  });
});

describe("aiperf extraArgs escape hatch", () => {
  const withExtra = (extraArgs: string) =>
    buildCommand({ ...plan, params: { ...baseParams, extraArgs } }).argv;

  it("appends extra args after managed flags", () => {
    const argv = withExtra(`--extra-inputs chat_template_kwargs:'{"enable_thinking":false}'`);
    const i = argv.indexOf("--extra-inputs");
    expect(i).toBeGreaterThan(0);
    expect(argv[i + 1]).toBe(`chat_template_kwargs:{"enable_thinking":false}`);
    // the extra args are the LAST two tokens, appended after --artifact-dir out
    expect(argv.slice(-2)).toEqual([
      "--extra-inputs",
      `chat_template_kwargs:{"enable_thinking":false}`,
    ]);
    expect(argv[argv.length - 4]).toBe("--artifact-dir");
  });

  it("rejects overriding a managed flag", () => {
    expect(() => withExtra("--model evil")).toThrow(ExtraArgsError);
  });

  it("is a no-op when extraArgs is absent", () => {
    expect(buildCommand(plan).argv).not.toContain("--extra-inputs");
  });
});
