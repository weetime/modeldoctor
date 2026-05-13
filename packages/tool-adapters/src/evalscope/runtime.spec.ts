import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildCommandPlan } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import type { EvalscopeParams } from "./schema.js";

const fixturePath = (n: string) => join(__dirname, "__fixtures__", n);

const baseParams: EvalscopeParams = {
  parallel: 16,
  number: 128,
  dataset: "longalpaca",
  minPromptLength: 11000,
  maxPromptLength: 13000,
  minTokens: 300,
  maxTokens: 400,
  apiPath: "/v1/chat/completions",
  stream: true,
  seed: 42,
};

const plan: BuildCommandPlan<EvalscopeParams> = {
  runId: "r1",
  params: baseParams,
  connection: {
    baseUrl: "http://10.0.0.5:8000",
    apiKey: "sk-test",
    model: "gen-studio_Qwen3-32B-rJIp",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: null,
    prometheusUrl: null,
  },
  callback: { url: "http://api/", token: "tk" },
};

describe("evalscope.buildCommand", () => {
  it("emits the expected evalscope CLI argv for Task 4 (high-pressure long prompt)", () => {
    const result = buildCommand(plan);
    expect(result.argv).toEqual([
      "evalscope",
      "perf",
      "--url",
      "http://10.0.0.5:8000/v1/chat/completions",
      "--api",
      "openai",
      "--model",
      "gen-studio_Qwen3-32B-rJIp",
      "--parallel",
      "16",
      "--number",
      "128",
      "--dataset",
      "longalpaca",
      "--dataset-path",
      "/opt/evalscope-datasets/longalpaca",
      "--min-prompt-length",
      "11000",
      "--max-prompt-length",
      "13000",
      "--min-tokens",
      "300",
      "--max-tokens",
      "400",
      "--seed",
      "42",
      "--stream",
      "--outputs-dir",
      "out",
      "--no-timestamp",
      "--name",
      "evalscope-run",
    ]);
    expect(result.secretEnv?.OPENAI_API_KEY).toBe("sk-test");
  });

  it("uses /v1/completions in --url when apiPath set to completions", () => {
    const result = buildCommand({
      ...plan,
      params: { ...baseParams, apiPath: "/v1/completions" },
    });
    expect(result.argv).toContain("http://10.0.0.5:8000/v1/completions");
  });

  it("omits --dataset-path when dataset is not longalpaca (lets evalscope use its own default)", () => {
    const result = buildCommand({ ...plan, params: { ...baseParams, dataset: "openqa" } });
    expect(result.argv).not.toContain("--dataset-path");
  });

  it("omits --seed when not provided", () => {
    const result = buildCommand({
      ...plan,
      params: { ...baseParams, seed: undefined },
    });
    expect(result.argv).not.toContain("--seed");
  });

  it("uses --no-stream when stream=false", () => {
    const result = buildCommand({
      ...plan,
      params: { ...baseParams, stream: false },
    });
    expect(result.argv).toContain("--no-stream");
    expect(result.argv).not.toContain("--stream");
  });

  it("declares both output files (summary + percentile)", () => {
    const result = buildCommand(plan);
    expect(result.outputFiles).toEqual({
      summary: "out/evalscope-run/benchmark_summary.json",
      percentile: "out/evalscope-run/benchmark_percentile.json",
    });
  });

  it("strips trailing slashes from connection.baseUrl before appending apiPath", () => {
    const result = buildCommand({
      ...plan,
      connection: { ...plan.connection, baseUrl: "http://10.0.0.5:8000///" },
    });
    expect(result.argv).toContain("http://10.0.0.5:8000/v1/chat/completions");
    expect(result.argv).not.toContain("http://10.0.0.5:8000////v1/chat/completions");
  });
});

describe("evalscope.parseFinalReport", () => {
  it("maps the summary + percentile fixtures into a valid EvalscopeReport", () => {
    const summary = readFileSync(fixturePath("benchmark_summary.json"));
    const percentile = readFileSync(fixturePath("benchmark_percentile.json"));
    const report = parseFinalReport("", { summary, percentile });
    expect(report.tool).toBe("evalscope");
    if (report.tool !== "evalscope") throw new Error(`expected evalscope, got ${report.tool}`);
    expect(report.data.requests.total).toBe(128);
    expect(report.data.requests.success).toBe(128);
    expect(report.data.requests.error).toBe(0);
    expect(report.data.requests.errorRate).toBe(0);
    expect(report.data.throughput.outputTokensPerSec).toBeCloseTo(587.1);
    expect(report.data.throughput.requestsPerSec).toBeCloseTo(1.697);
    // TTFT mean from summary (6432.1) and percentile p50 from percentile file
    expect(report.data.ttft.mean).toBeCloseTo(6432.1);
    expect(report.data.ttft.p50).toBeCloseTo(5980.2);
    expect(report.data.ttft.p99).toBeCloseTo(12054.6);
    expect(report.data.e2eLatency.p95).toBeCloseTo(13210); // 13.21s → 13210ms
    expect(report.data.itl.p90).toBeCloseTo(36.4);
    // prefix cache: 64.3% → 0.643
    expect(report.data.prefixCacheStats?.hitRate).toBeCloseTo(0.643);
  });

  it("returns prefixCacheStats=undefined when KV Cache Hit Rate is absent", () => {
    const summary = Buffer.from(
      JSON.stringify({
        "Test Duration (s)": 10,
        "Concurrency": 4,
        "Total Requests": 8,
        "Success Requests": 8,
        "Failed Requests": 0,
        "Req Throughput (req/s)": 0.8,
        "Avg Latency (s)": 5,
        "Avg Input Tokens": 100,
        "Output Throughput (tok/s)": 200,
        "Total Throughput (tok/s)": 250,
        "TTFT (ms)": 300,
        "TPOT (ms)": 20,
        "ITL (ms)": 25,
        "Avg Output Tokens": 50,
      }),
    );
    const percentile = readFileSync(fixturePath("benchmark_percentile.json"));
    const report = parseFinalReport("", { summary, percentile });
    if (report.tool !== "evalscope") throw new Error(`expected evalscope, got ${report.tool}`);
    expect(report.data.prefixCacheStats).toBeUndefined();
  });

  it("throws if the summary file is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow(/missing.*summary/);
  });

  it("computes errorRate from total / failed when both present", () => {
    const summary = Buffer.from(
      JSON.stringify({
        "Test Duration (s)": 10,
        "Concurrency": 4,
        "Total Requests": 10,
        "Success Requests": 8,
        "Failed Requests": 2,
        "Req Throughput (req/s)": 0.8,
        "Avg Latency (s)": 5,
        "Avg Input Tokens": 100,
        "Output Throughput (tok/s)": 200,
        "Total Throughput (tok/s)": 250,
        "TTFT (ms)": 300,
        "TPOT (ms)": 20,
        "ITL (ms)": 25,
        "Avg Output Tokens": 50,
      }),
    );
    const percentile = readFileSync(fixturePath("benchmark_percentile.json"));
    const report = parseFinalReport("", { summary, percentile });
    if (report.tool !== "evalscope") throw new Error(`expected evalscope, got ${report.tool}`);
    expect(report.data.requests.errorRate).toBeCloseTo(0.2);
  });
});

describe("evalscope.parseProgress", () => {
  it("returns null for unrecognized lines", () => {
    expect(parseProgress("noise")).toBeNull();
  });
});

describe("evalscope.getMaxDurationSeconds", () => {
  it("derives a buffered ceiling between the floor and cap", () => {
    const sec = getMaxDurationSeconds(baseParams);
    expect(sec).toBeGreaterThanOrEqual(120);
    expect(sec).toBeLessThanOrEqual(3600);
  });

  it("scales with number / parallel", () => {
    const small = getMaxDurationSeconds({ ...baseParams, number: 8, parallel: 8 });
    const large = getMaxDurationSeconds({ ...baseParams, number: 1000, parallel: 8 });
    expect(large).toBeGreaterThan(small);
  });
});
