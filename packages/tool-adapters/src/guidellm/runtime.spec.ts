import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExtraArgsError } from "../core/extra-args.js";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureBuf = fs.readFileSync(path.join(__dirname, "__fixtures__/report.json"));

const baseConn = {
  baseUrl: "http://localhost:8000",
  apiKey: "sk-test",
  model: "Qwen2.5-0.5B-Instruct",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: null,
  prometheusDatasource: null,
};

const defaultParams = {
  profile: "throughput" as const,
  apiType: "chat" as const,
  datasetName: "random" as const,
  datasetInputTokens: 256,
  datasetOutputTokens: 128,
  rateType: "constant" as const,
  requestRate: 0,
  totalRequests: 100,
  maxDurationSeconds: 300,
  maxConcurrency: 50,
  validateBackend: true,
};

describe("guidellm.buildCommand", () => {
  it("includes core CLI args + outputFiles entry", () => {
    const r = buildCommand({
      runId: "r1",
      params: {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 256,
        datasetOutputTokens: 128,
        rateType: "constant",
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 300,
        maxConcurrency: 50,
        validateBackend: true,
      },
      connection: baseConn,
    });
    expect(r.argv[0]).toBe("guidellm");
    expect(r.argv).toContain("--target=http://localhost:8000");
    expect(r.argv).toContain("--model=Qwen2.5-0.5B-Instruct");
    expect(r.argv).toContain("--max-requests=100");
    expect(r.argv).toContain("--output-path=report.json");
    expect(r.outputFiles.report).toBe("report.json");
  });

  it("does not put apiKey in argv (must be in secretEnv)", () => {
    const r = buildCommand({
      runId: "r1",
      params: {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 256,
        datasetOutputTokens: 128,
        rateType: "constant",
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 300,
        maxConcurrency: 50,
        validateBackend: true,
      },
      connection: baseConn,
    });
    expect(r.argv.join(" ")).not.toContain("sk-test");
    // Reasonable place: backend-kwargs JSON. We accept either explicit
    // --backend-kwargs or env-driven path; test the strict invariant.
  });

  it("uses constant rate when requestRate > 0", () => {
    const r = buildCommand({
      runId: "r1",
      params: {
        profile: "latency",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 128,
        datasetOutputTokens: 64,
        rateType: "constant",
        requestRate: 10,
        totalRequests: 100,
        maxDurationSeconds: 60,
        maxConcurrency: 50,
        validateBackend: true,
      },
      connection: baseConn,
    });
    expect(r.argv).toContain("--rate-type=constant");
    expect(r.argv).toContain("--rate=10");
  });

  it("uses throughput mode with maxConcurrency when requestRate = 0", () => {
    const r = buildCommand({
      runId: "r1",
      params: {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 128,
        datasetOutputTokens: 64,
        rateType: "throughput",
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 60,
        maxConcurrency: 75,
        validateBackend: true,
      },
      connection: baseConn,
    });
    expect(r.argv).toContain("--rate-type=throughput");
    expect(r.argv).toContain("--rate=75");
  });

  it("always emits --backend-kwargs= so the runner can merge OPENAI_API_KEY", () => {
    const result = buildCommand({
      runId: "r1",
      params: {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 256,
        datasetOutputTokens: 128,
        rateType: "constant",
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 300,
        maxConcurrency: 50,
        validateBackend: true,
      },
      connection: {
        baseUrl: "http://x",
        apiKey: "sk",
        model: "m",
        customHeaders: "",
        queryParams: "",
        tokenizerHfId: null,
        prometheusDatasource: null,
      },
    });
    expect(result.argv.some((a) => a.startsWith("--backend-kwargs="))).toBe(true);
    const flag = result.argv.find((a) => a.startsWith("--backend-kwargs="));
    if (!flag) throw new Error("--backend-kwargs= not found in argv");
    const kwargs = JSON.parse(flag.replace("--backend-kwargs=", ""));
    expect(kwargs).toEqual({}); // validateBackend=true → no validate_backend key in --backend-kwargs; runner injects api_key
  });

  it("emits --backend-kwargs={validate_backend:false} when validateBackend=false", () => {
    const result = buildCommand({
      runId: "r1",
      params: {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 256,
        datasetOutputTokens: 128,
        rateType: "constant",
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 300,
        maxConcurrency: 50,
        validateBackend: false,
      },
      connection: {
        baseUrl: "http://x",
        apiKey: "sk",
        model: "m",
        customHeaders: "",
        queryParams: "",
        tokenizerHfId: null,
        prometheusDatasource: null,
      },
    });
    const flag = result.argv.find((a) => a.startsWith("--backend-kwargs="));
    if (!flag) throw new Error("--backend-kwargs= not found in argv");
    expect(JSON.parse(flag.replace("--backend-kwargs=", ""))).toEqual({ validate_backend: false });
  });

  it("uses params.processor when provided (per-run override)", () => {
    const result = buildCommand({
      runId: "r1",
      params: { ...defaultParams, processor: "Qwen/Per-Run" },
      connection: {
        baseUrl: "http://x",
        apiKey: "sk",
        model: "m",
        customHeaders: "",
        queryParams: "",
        tokenizerHfId: "Qwen/Connection",
        prometheusDatasource: null,
      },
    });
    expect(result.argv).toContain("--processor=Qwen/Per-Run");
  });

  it("falls back to connection.tokenizerHfId when no params.processor", () => {
    const result = buildCommand({
      runId: "r1",
      params: { ...defaultParams, processor: undefined },
      connection: {
        baseUrl: "http://x",
        apiKey: "sk",
        model: "m",
        customHeaders: "",
        queryParams: "",
        tokenizerHfId: "Qwen/Connection",
        prometheusDatasource: null,
      },
    });
    expect(result.argv).toContain("--processor=Qwen/Connection");
  });

  it("omits --processor when neither is set", () => {
    const result = buildCommand({
      runId: "r1",
      params: { ...defaultParams, processor: undefined },
      connection: {
        baseUrl: "http://x",
        apiKey: "sk",
        model: "m",
        customHeaders: "",
        queryParams: "",
        tokenizerHfId: null,
        prometheusDatasource: null,
      },
    });
    expect(result.argv.find((a) => a.startsWith("--processor="))).toBeUndefined();
  });
});

describe("guidellm.parseProgress", () => {
  it("returns null for non-progress lines", () => {
    expect(parseProgress("some random log line")).toBeNull();
  });
});

describe("guidellm.parseFinalReport", () => {
  it("parses the fixture into a typed ToolReport", () => {
    const result = parseFinalReport("", { report: fixtureBuf });
    expect(result.tool).toBe("guidellm");
    if (result.tool !== "guidellm") throw new Error(`expected guidellm, got ${result.tool}`);
    expect(result.data.ttft).toBeDefined();
    expect(result.data.ttft.p50).toBeGreaterThan(0);
    expect(result.data.requests.total).toBeGreaterThan(0);
  });

  it("throws on malformed fixture (missing report file)", () => {
    expect(() => parseFinalReport("", {})).toThrow();
  });
});

describe("guidellm.parseFinalReport capacityCurve", () => {
  function makeBench(concurrency: number, rps: number, e2eLatencySeconds: number) {
    return {
      metrics: {
        request_concurrency: {
          successful: {
            mean: concurrency,
            max: concurrency,
            percentiles: { p50: concurrency, p90: concurrency, p95: concurrency, p99: concurrency },
          },
        },
        requests_per_second: {
          successful: {
            mean: rps,
            max: rps,
            percentiles: { p50: rps, p90: rps, p95: rps, p99: rps },
          },
        },
        request_latency: {
          successful: {
            mean: e2eLatencySeconds,
            max: e2eLatencySeconds,
            percentiles: {
              p50: e2eLatencySeconds,
              p90: e2eLatencySeconds,
              p95: e2eLatencySeconds,
              p99: e2eLatencySeconds,
            },
          },
        },
        time_to_first_token_ms: {
          successful: { mean: 0, max: 0, percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 } },
        },
        inter_token_latency_ms: {
          successful: { mean: 0, max: 0, percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 } },
        },
        output_tokens_per_second: {
          successful: { mean: 0, max: 0, percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 } },
        },
        prompt_tokens_per_second: {
          successful: { mean: 0, max: 0, percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 } },
        },
        tokens_per_second: {
          successful: { mean: 0, max: 0, percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 } },
        },
        request_totals: { total: 10, successful: 10, errored: 0, incomplete: 0 },
      },
    };
  }

  it("extracts capacityCurve sorted ascending by concurrency from 3 sweep benches", () => {
    // Input: non-sorted concurrency order (64, 4, 16) to verify sort
    const raw = {
      benchmarks: [
        makeBench(64, 30, 2.5), // concurrency=64, e2eP95Ms=2500
        makeBench(4, 5, 0.1), // concurrency=4,  e2eP95Ms=100
        makeBench(16, 15, 0.8), // concurrency=16, e2eP95Ms=800
      ],
    };
    const buf = Buffer.from(JSON.stringify(raw), "utf8");
    const result = parseFinalReport("", { report: buf });
    if (result.tool !== "guidellm") throw new Error(`expected guidellm, got ${result.tool}`);

    const curve = result.data.capacityCurve;
    expect(curve).toBeDefined();
    expect(curve).toHaveLength(3);

    // Sorted ascending by concurrency
    expect(curve![0].concurrency).toBe(4);
    expect(curve![1].concurrency).toBe(16);
    expect(curve![2].concurrency).toBe(64);

    // First point: e2eP95Ms = 0.1 seconds × 1000 = 100 ms
    expect(curve![0].e2eP95Ms).toBeCloseTo(100);
  });

  it("returns undefined capacityCurve for single-bench (non-sweep) runs", () => {
    const raw = { benchmarks: [makeBench(8, 10, 0.5)] };
    const buf = Buffer.from(JSON.stringify(raw), "utf8");
    const result = parseFinalReport("", { report: buf });
    if (result.tool !== "guidellm") throw new Error(`expected guidellm, got ${result.tool}`);
    expect(result.data.capacityCurve).toBeUndefined();
  });
});

describe("guidellm extraArgs escape hatch", () => {
  const withExtra = (extraArgs: string) =>
    buildCommand({ runId: "r1", params: { ...defaultParams, extraArgs }, connection: baseConn })
      .argv;

  it("appends extra args", () => {
    const argv = withExtra("--warmup-percent 0.1");
    const i = argv.indexOf("--warmup-percent");
    expect(i).toBeGreaterThan(0);
    expect(argv[i + 1]).toBe("0.1");
  });

  it("rejects overriding a managed flag", () => {
    expect(() => withExtra("--target http://evil")).toThrow(ExtraArgsError);
  });

  it("is a no-op when extraArgs is absent", () => {
    const argv = buildCommand({ runId: "r1", params: defaultParams, connection: baseConn }).argv;
    expect(argv).not.toContain("--warmup-percent");
  });
});
