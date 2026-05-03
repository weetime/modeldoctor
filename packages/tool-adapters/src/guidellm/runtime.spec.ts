import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
};

const defaultParams = {
  profile: "throughput" as const,
  apiType: "chat" as const,
  datasetName: "random" as const,
  datasetInputTokens: 256,
  datasetOutputTokens: 128,
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
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 300,
        maxConcurrency: 50,
        validateBackend: true,
      },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
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
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 300,
        maxConcurrency: 50,
        validateBackend: true,
      },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
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
        requestRate: 10,
        totalRequests: 100,
        maxDurationSeconds: 60,
        maxConcurrency: 50,
        validateBackend: true,
      },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
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
        requestRate: 0,
        totalRequests: 100,
        maxDurationSeconds: 60,
        maxConcurrency: 75,
        validateBackend: true,
      },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
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
      },
      callback: { url: "http://cb", token: "t" },
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
      },
      callback: { url: "http://cb", token: "t" },
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
      },
      callback: { url: "http://cb", token: "t" },
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
      },
      callback: { url: "http://cb", token: "t" },
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
      },
      callback: { url: "http://cb", token: "t" },
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
