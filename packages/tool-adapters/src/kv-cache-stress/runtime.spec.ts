import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureBuf = fs.readFileSync(path.join(__dirname, "__fixtures__/result.json"));

const baseConn = {
  baseUrl: "http://10.100.121.67:31700",
  apiKey: "sk-test",
  model: "Qwen/Qwen3-32B",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: null,
  prometheusUrl: "http://10.100.121.67:30121",
};

const baseParams = {
  numSessions: 200,
  turns: 4,
  concurrency: 25,
  maxTokens: 50,
  durationSec: 600,
  systemPromptSeed: "scn",
};

describe("kv-cache-stress.buildCommand", () => {
  it("argv is python /app/probe.py with required flags", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv[0]).toBe("python");
    expect(r.argv[1]).toBe("/app/probe.py");
    const flat = r.argv.join(" ");
    expect(flat).toContain("--base-url http://10.100.121.67:31700");
    expect(flat).toContain("--model Qwen/Qwen3-32B");
    expect(flat).toContain("--num-sessions 200");
    expect(flat).toContain("--turns 4");
    expect(flat).toContain("--concurrency 25");
    expect(flat).toContain("--max-tokens 50");
    expect(flat).toContain("--duration 600");
    expect(flat).toContain("--system-prompt-seed scn");
    expect(flat).toContain("--out result.json");
  });

  it("includes --prom-url when connection.prometheusUrl is set", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv.join(" ")).toContain("--prom-url http://10.100.121.67:30121");
  });

  it("omits --prom-url when connection.prometheusUrl is null", () => {
    const conn = { ...baseConn, prometheusUrl: null };
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: conn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv.join(" ")).not.toContain("--prom-url");
  });

  it("apiKey ships via secretEnv.OPENAI_API_KEY (never argv)", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv.join(" ")).not.toContain("sk-test");
    expect(r.secretEnv.OPENAI_API_KEY).toBe("sk-test");
  });

  it("outputFiles.result is result.json", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.outputFiles.result).toBe("result.json");
  });
});

describe("kv-cache-stress.parseProgress", () => {
  it("parses '  + 15s  ok=100  err=2  completion_tokens=4830' into progress event", () => {
    const evt = parseProgress("  + 15s  ok=100  err=2  completion_tokens=4830");
    expect(evt).not.toBeNull();
    if (!evt || evt.kind !== "progress") throw new Error("expected progress event");
    expect(evt.currentRequests).toBe(102);
    expect(evt.message).toBe("ok=100 err=2");
  });

  it("parses progress without completion_tokens suffix (early ticks)", () => {
    const evt = parseProgress("  + 16s  ok=0  err=5");
    expect(evt).not.toBeNull();
    if (!evt || evt.kind !== "progress") throw new Error("expected progress event");
    expect(evt.currentRequests).toBe(5);
  });

  it("returns null for unrelated lines (warnings, banners, SUMMARY block)", () => {
    expect(parseProgress("BASE_URL=http://x  MODEL=y  API_KEY=set")).toBeNull();
    expect(parseProgress("=== SUMMARY ===")).toBeNull();
    expect(parseProgress("")).toBeNull();
  });
});

describe("kv-cache-stress.parseFinalReport", () => {
  it("parses LMCache fixture into typed report", () => {
    const r = parseFinalReport("", { result: fixtureBuf });
    expect(r.tool).toBe("kv-cache-stress");
    if (r.tool !== "kv-cache-stress") throw new Error("type narrowing");
    expect(r.data.qps).toBe(3.75);
    expect(r.data.backend.nameGuess).toBe("lmcache");
    expect(r.data.prom.prefixCacheSavingsPct).toBe(85.1);
  });

  it("throws when files.result is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow(/missing 'result'/);
  });
});

describe("kv-cache-stress.getMaxDurationSeconds", () => {
  it("returns durationSec + 120 (pre/post snapshot + warmup grace)", () => {
    expect(getMaxDurationSeconds(baseParams)).toBe(720);
    expect(getMaxDurationSeconds({ ...baseParams, durationSec: 300 })).toBe(420);
    expect(getMaxDurationSeconds({ ...baseParams, durationSec: 7200 })).toBe(7320);
  });
});
