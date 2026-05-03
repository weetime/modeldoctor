import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureBuf = fs.readFileSync(
  path.join(__dirname, "__fixtures__/profile_export_genai_perf.json"),
);

const baseConn = {
  baseUrl: "http://localhost:8000",
  apiKey: "sk-test",
  model: "Qwen2.5-0.5B-Instruct",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: null,
};

const baseParams = {
  endpointType: "chat" as const,
  numPrompts: 100,
  concurrency: 1,
  inputTokensStddev: 0,
  outputTokensStddev: 0,
  streaming: true,
};

describe("genai-perf.buildCommand", () => {
  it("emits /bin/sh -c as argv[0..1]", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv[0]).toBe("/bin/sh");
    expect(r.argv[1]).toBe("-c");
    expect(typeof r.argv[2]).toBe("string");
  });

  it("script contains genai-perf profile invocation", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    const script = r.argv[2];
    expect(script).toContain("genai-perf profile");
  });

  it("script uses positional args ($1, $2, ...) for user-supplied values", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    const script = r.argv[2];
    // Model, baseUrl etc. are passed as positional args, not inlined
    expect(script).toMatch(/"\$1"/);
    expect(script).toMatch(/"\$2"/);
  });

  it("script contains find artifacts copy for dynamic artifact subdir", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    const script = r.argv[2];
    expect(script).toContain("find");
    expect(script).toContain("profile_export_genai_perf.json");
  });

  it("positional args contain model, baseUrl, endpoint-type, numPrompts, concurrency, streaming", () => {
    const r = buildCommand({
      runId: "r1",
      params: { ...baseParams, numPrompts: 50, concurrency: 4 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    // argv[3] is the sh -c name slot ("genai-perf-wrapper")
    // $1=model, $2=baseUrl, $3=endpointType, $4=numPrompts, $5=concurrency, $6=streaming
    expect(r.argv[3]).toBe("genai-perf-wrapper");
    expect(r.argv[4]).toBe("Qwen2.5-0.5B-Instruct"); // model → $1
    expect(r.argv[5]).toBe("http://localhost:8000"); // baseUrl → $2
    expect(r.argv[6]).toBe("chat"); // endpointType → $3
    expect(r.argv[7]).toBe("50"); // numPrompts → $4
    expect(r.argv[8]).toBe("4"); // concurrency → $5
  });

  it("streaming flag appears in positional args and toggles --streaming in script", () => {
    const withStreaming = buildCommand({
      runId: "r1",
      params: { ...baseParams, streaming: true },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    const withoutStreaming = buildCommand({
      runId: "r1",
      params: { ...baseParams, streaming: false },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    // The streaming positional arg is "true" or "false"
    const streamingArgWithTrue = withStreaming.argv.find((a) => a === "true");
    const streamingArgWithFalse = withoutStreaming.argv.find((a) => a === "false");
    expect(streamingArgWithTrue).toBe("true");
    expect(streamingArgWithFalse).toBe("false");
    // Script handles --streaming conditional
    expect(withStreaming.argv[2]).toContain("--streaming");
    // Regression guard: the conditional structure must be intact (not always-on)
    expect(withStreaming.argv[2]).toContain(
      'if [ "$6" = "true" ]; then STREAMING="--streaming"; fi',
    );
  });

  it("does not enable --streaming when streaming=false", () => {
    const r = buildCommand({
      runId: "r1",
      params: { ...baseParams, streaming: false },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    // $6 must be the literal string "false" so the shell conditional skips --streaming
    expect(r.argv[9]).toBe("false"); // $6 maps to argv[9] (argv[3] is name slot, $1=argv[4])
  });

  it("apiKey does NOT appear in argv (ships via secretEnv.OPENAI_API_KEY)", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv.join(" ")).not.toContain("sk-test");
    expect(r.secretEnv.OPENAI_API_KEY).toBe("sk-test");
  });

  it("outputFiles.profile is the suffix-augmented filename", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    // Upstream JsonExporter appends _genai_perf.json (Deviation 1)
    expect(r.outputFiles.profile).toBe("profile_export_genai_perf.json");
  });

  it("optional inputTokensMean materializes in argv when set", () => {
    const r = buildCommand({
      runId: "r1",
      params: { ...baseParams, inputTokensMean: 256, inputTokensStddev: 10 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    // Either script string or positional args must include the token count
    const argvStr = r.argv.join(" ");
    expect(argvStr).toContain("256");
  });

  it("optional outputTokensMean materializes in argv when set", () => {
    const r = buildCommand({
      runId: "r1",
      params: { ...baseParams, outputTokensMean: 512 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    const argvStr = r.argv.join(" ");
    expect(argvStr).toContain("512");
  });

  it("emits Authorization header in the shell script", () => {
    const result = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: {
        baseUrl: "http://x", apiKey: "sk-test-secret-12345", model: "m",
        customHeaders: "", queryParams: "", tokenizerHfId: null,
      },
      callback: { url: "http://cb", token: "t" },
    });
    const script = result.argv[2]; // sh -c <script>
    expect(script).toContain('--header "Authorization: Bearer $OPENAI_API_KEY"');
    // Sanity: api_key is NOT in argv anywhere (it'd leak into ps).
    expect(result.argv.join(" ")).not.toContain("sk-test-secret-12345");
  });

  it("uses params.tokenizer when provided (per-run override)", () => {
    const result = buildCommand({
      runId: "r1",
      params: { ...baseParams, tokenizer: "Qwen/Per-Run" },
      connection: {
        baseUrl: "http://x", apiKey: "sk", model: "m",
        customHeaders: "", queryParams: "", tokenizerHfId: "Qwen/Connection",
      },
      callback: { url: "http://cb", token: "t" },
    });
    const script = result.argv[2];
    expect(script).toMatch(/--tokenizer\s+"\$\d+"/);
    expect(result.argv).toContain("Qwen/Per-Run");
    expect(result.argv).not.toContain("Qwen/Connection");
  });

  it("falls back to connection.tokenizerHfId when no params.tokenizer", () => {
    const result = buildCommand({
      runId: "r1",
      params: { ...baseParams, tokenizer: undefined },
      connection: {
        baseUrl: "http://x", apiKey: "sk", model: "m",
        customHeaders: "", queryParams: "", tokenizerHfId: "Qwen/Connection",
      },
      callback: { url: "http://cb", token: "t" },
    });
    const script = result.argv[2];
    expect(script).toMatch(/--tokenizer\s+"\$\d+"/);
    expect(result.argv).toContain("Qwen/Connection");
  });

  it("omits --tokenizer when neither is set", () => {
    const result = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: {
        baseUrl: "http://x", apiKey: "sk", model: "m",
        customHeaders: "", queryParams: "", tokenizerHfId: null,
      },
      callback: { url: "http://cb", token: "t" },
    });
    const script = result.argv[2];
    expect(script).not.toContain("--tokenizer");
  });
});

describe("genai-perf.parseProgress", () => {
  it("returns null for any input (genai-perf progress format not yet supported)", () => {
    expect(parseProgress("")).toBeNull();
    expect(parseProgress("some line")).toBeNull();
    expect(parseProgress("[I] Running benchmarks...")).toBeNull();
  });
});

describe("genai-perf.parseFinalReport", () => {
  it("parses fixture into typed ToolReport", () => {
    const result = parseFinalReport("", { profile: fixtureBuf });
    expect(result.tool).toBe("genai-perf");
    expect(result.data).toBeDefined();
  });

  it("round-trip: timeToFirstToken.p99 is 18.81", () => {
    const result = parseFinalReport("", { profile: fixtureBuf });
    if (result.tool !== "genai-perf") throw new Error(`expected genai-perf, got ${result.tool}`);
    expect(result.data.timeToFirstToken.p99).toBe(18.81);
  });

  it("round-trip: requestThroughput.avg is 4.87", () => {
    const result = parseFinalReport("", { profile: fixtureBuf });
    if (result.tool !== "genai-perf") throw new Error(`expected genai-perf, got ${result.tool}`);
    expect(result.data.requestThroughput.avg).toBe(4.87);
  });

  it("round-trip: requestLatency.stddev is 11.23 (proves std → stddev mapping, Deviation 2)", () => {
    const result = parseFinalReport("", { profile: fixtureBuf });
    if (result.tool !== "genai-perf") throw new Error(`expected genai-perf, got ${result.tool}`);
    expect(result.data.requestLatency.stddev).toBe(11.23);
  });

  it("round-trip: requestLatency.unit is 'ms'", () => {
    const result = parseFinalReport("", { profile: fixtureBuf });
    if (result.tool !== "genai-perf") throw new Error(`expected genai-perf, got ${result.tool}`);
    expect(result.data.requestLatency.unit).toBe("ms");
  });

  it("throws when files.profile is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow();
  });

  it("throws when files.profile is not valid JSON", () => {
    expect(() => parseFinalReport("", { profile: Buffer.from("not json") })).toThrow();
  });
});

describe("genai-perf.getMaxDurationSeconds", () => {
  it("returns at least 60 seconds", () => {
    const secs = getMaxDurationSeconds({ ...baseParams, numPrompts: 1 });
    expect(secs).toBeGreaterThanOrEqual(60);
  });

  it("returns a finite positive number", () => {
    const secs = getMaxDurationSeconds(baseParams);
    expect(Number.isFinite(secs)).toBe(true);
    expect(secs).toBeGreaterThan(0);
  });

  it("numPrompts=10, concurrency=1 → 100 (ceil(10/1)*10=100, max(60,100)=100)", () => {
    const secs = getMaxDurationSeconds({ ...baseParams, numPrompts: 10, concurrency: 1 });
    expect(secs).toBe(100);
  });

  it("numPrompts=10, concurrency=10 → 60 (ceil(10/10)*10=10, max(60,10)=60)", () => {
    const secs = getMaxDurationSeconds({ ...baseParams, numPrompts: 10, concurrency: 10 });
    expect(secs).toBe(60);
  });

  it("numPrompts=1000, concurrency=100 → 100 (ceil(1000/100)*10=100)", () => {
    const secs = getMaxDurationSeconds({ ...baseParams, numPrompts: 1000, concurrency: 100 });
    expect(secs).toBe(100);
  });

  it("numPrompts=1000, concurrency=1 → 10000 (ceil(1000/1)*10=10000)", () => {
    const secs = getMaxDurationSeconds({ ...baseParams, numPrompts: 1000, concurrency: 1 });
    expect(secs).toBe(10000);
  });
});
