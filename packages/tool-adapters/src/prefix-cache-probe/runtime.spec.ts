import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureBuf = fs.readFileSync(path.join(__dirname, "__fixtures__/result.json"));

const baseConn = {
  baseUrl: "http://10.100.121.67:30888",
  apiKey: "sk-test",
  model: "Qwen/Qwen2.5-0.5B-Instruct",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: null,
  prometheusDatasource: {
    id: "ds_test",
    baseUrl: "http://10.100.121.67:30121",
    bearerToken: null,
  } as { id: string; baseUrl: string; bearerToken: string | null } | null,
};

const baseParams = {
  promptSets: 2,
  requestsPerSet: 10,
  maxTokens: 5,
  promBackoffSec: 18,
};

describe("prefix-cache-probe.buildCommand", () => {
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
    expect(flat).toContain("--url http://10.100.121.67:30888");
    expect(flat).toContain("--prom http://10.100.121.67:30121");
    expect(flat).toContain("--model Qwen/Qwen2.5-0.5B-Instruct");
    expect(flat).toContain("--rounds 2");
    expect(flat).toContain("--requests 10");
    expect(flat).toContain("--max-tokens 5");
    expect(flat).toContain("--backoff 18");
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

  it("throws when connection has no prometheusDatasource bound", () => {
    const conn = { ...baseConn, prometheusDatasource: null };
    expect(() =>
      buildCommand({
        runId: "r1",
        params: baseParams,
        connection: conn,
        callback: { url: "http://api/", token: "tk" },
      }),
    ).toThrow(/Prometheus datasource/);
  });

  it("forwards bearerToken via secretEnv.PROM_BEARER_TOKEN (never argv) when set", () => {
    // Acceptance hook for #208: runners now have a path to authenticated
    // Prometheus scrapes. We lock both (a) the token reaches the env, and
    // (b) it never appears in the argv (kubelet logs / `ps` would leak it).
    const conn = {
      ...baseConn,
      prometheusDatasource: {
        id: "ds_secure",
        baseUrl: "http://10.100.121.67:30121",
        bearerToken: "supersecret",
      },
    };
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: conn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.secretEnv.PROM_BEARER_TOKEN).toBe("supersecret");
    expect(r.argv.join(" ")).not.toContain("supersecret");
  });

  it("omits PROM_BEARER_TOKEN entirely when the datasource is anonymous (bearerToken=null)", () => {
    // Anonymous Prometheus is the common dev-cluster case; we don't want to
    // export an empty PROM_BEARER_TOKEN that probe.py might interpret as
    // "Authorization: Bearer " (literal empty bearer).
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.secretEnv.PROM_BEARER_TOKEN).toBeUndefined();
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

describe("prefix-cache-probe.parseProgress", () => {
  it("returns null for any input", () => {
    expect(parseProgress("anything")).toBeNull();
  });
});

describe("prefix-cache-probe.parseFinalReport", () => {
  it("parses fixture into typed report", () => {
    const r = parseFinalReport("", { result: fixtureBuf });
    expect(r.tool).toBe("prefix-cache-probe");
    if (r.tool !== "prefix-cache-probe") throw new Error("type narrowing");
    expect(r.data.stickinessPct).toBe(95.0);
    expect(r.data.perPod).toHaveLength(2);
  });

  it("throws when files.result is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow();
  });
});

describe("prefix-cache-probe.getMaxDurationSeconds", () => {
  it("scales with promptSets * (requestsPerSet * 5 + promBackoffSec) + 60", () => {
    // 3 * (10 * 5 + 18) + 60 = 264
    expect(getMaxDurationSeconds({ ...baseParams, promptSets: 3 })).toBe(264);
  });
});
