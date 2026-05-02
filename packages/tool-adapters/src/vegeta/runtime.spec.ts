import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureBuf = fs.readFileSync(path.join(__dirname, "__fixtures__/report.txt"));
const compositeFixtureBuf = fs.readFileSync(
  path.join(__dirname, "__fixtures__/report-composite.txt"),
);

const baseConn = {
  baseUrl: "http://localhost:8000",
  apiKey: "sk-test",
  model: "Qwen2.5-0.5B-Instruct",
  customHeaders: "",
  queryParams: "",
};

describe("vegeta.buildCommand", () => {
  it("emits a shell pipeline argv via /bin/sh -c", () => {
    const r = buildCommand({
      runId: "r1",
      params: { apiType: "chat", rate: 10, duration: 30 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv[0]).toBe("/bin/sh");
    expect(r.argv[1]).toBe("-c");
    expect(r.argv[2]).toContain("vegeta attack");
    expect(r.argv[2]).toContain("-rate=10");
    expect(r.argv[2]).toContain("-duration=30s");
  });

  it("writes targets.txt as inputFile (with apiKey embedded)", () => {
    const r = buildCommand({
      runId: "r1",
      params: { apiType: "chat", rate: 10, duration: 30 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.inputFiles?.["targets.txt"]).toBeDefined();
    expect(r.inputFiles?.["targets.txt"]).toContain("Authorization: Bearer sk-test");
    // apiKey should NOT appear in argv or env (it's in the input file
    // which K8sJobDriver routes via Secret + volumeMount).
    expect(r.argv.join(" ")).not.toContain("sk-test");
    expect(JSON.stringify(r.env)).not.toContain("sk-test");
    expect(JSON.stringify(r.secretEnv)).not.toContain("sk-test");
  });

  it("declares output files for report and attack stream", () => {
    const r = buildCommand({
      runId: "r1",
      params: { apiType: "chat", rate: 10, duration: 30 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.outputFiles.report).toBe("report.txt");
    expect(r.outputFiles.attack).toBe("attack.bin");
  });
});

describe("vegeta.parseProgress", () => {
  it("always returns null (vegeta CLI is silent during attack)", () => {
    expect(parseProgress("any line")).toBeNull();
  });
});

describe("vegeta.parseFinalReport", () => {
  it("parses fixture into typed ToolReport with ms-converted latencies", () => {
    const result = parseFinalReport("", { report: fixtureBuf });
    expect(result.tool).toBe("vegeta");
    expect(result.data.requests.total).toBeGreaterThan(0);
    expect(result.data.latencies.p99).toBeGreaterThan(0);
    expect(result.data.success).toBeGreaterThan(0);
    // unit conversion check: "78ms" should land as ~78 (number)
    expect(typeof result.data.latencies.p99).toBe("number");
    // µs → ms conversion: fixture min = "500µs" should convert to 0.5 ms
    expect(result.data.latencies.min).toBe(0.5);
  });

  it("throws when 'report' file is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow();
  });
});

describe("vegeta.parseFinalReport — composite Go durations", () => {
  it("parses composite latencies (1m30s, 2m, 1h2m) from fixture", () => {
    const result = parseFinalReport("", { report: compositeFixtureBuf });
    expect(result.tool).toBe("vegeta");
    // 100µs → 0.1 ms
    expect(result.data.latencies.min).toBeCloseTo(0.1, 6);
    // 1m30s → 90000 ms
    expect(result.data.latencies.mean).toBeCloseTo(90000, 0);
    // 2m → 120000 ms
    expect(result.data.latencies.p50).toBeCloseTo(120000, 0);
    // 1h2m → 3720000 ms
    expect(result.data.latencies.p90).toBeCloseTo(3720000, 0);
    // 1h2m3s → 3723000 ms
    expect(result.data.latencies.p95).toBeCloseTo(3723000, 0);
    // 90s → 90000 ms
    expect(result.data.latencies.p99).toBeCloseTo(90000, 0);
    // 102ms → 102 ms
    expect(result.data.latencies.max).toBeCloseTo(102, 0);
  });

  it("parses composite duration total (5m12.3s) correctly", () => {
    const result = parseFinalReport("", { report: compositeFixtureBuf });
    // 5m12.3s = 312.3 s
    expect(result.data.duration.totalSeconds).toBeCloseTo(312.3, 3);
    // 5m10s = 310 s
    expect(result.data.duration.attackSeconds).toBeCloseTo(310, 3);
    // 2.3s
    expect(result.data.duration.waitSeconds).toBeCloseTo(2.3, 3);
  });

  it("parseDurationToSeconds handles µs input (was broken: returned NaN)", () => {
    // This tests the previously-broken parseDurationToSeconds path via
    // a report where the wait value is in µs (sub-millisecond wait).
    const reportWithMicrosecondWait = [
      "Requests      [total, rate, throughput]         10, 10.00, 9.90",
      "Duration      [total, attack, wait]             1.005s, 1s, 500µs",
      "Latencies     [min, mean, 50, 90, 95, 99, max]  1ms, 2ms, 2ms, 3ms, 4ms, 5ms, 6ms",
      "Bytes In      [total, mean]                     1000, 100.00",
      "Bytes Out     [total, mean]                     500, 50.00",
      "Success       [ratio]                           100.00%",
      "Status Codes  [code:count]                      200:10",
    ].join("\n");
    const result = parseFinalReport("", {
      report: Buffer.from(reportWithMicrosecondWait),
    });
    // 500µs = 0.0005 s
    expect(result.data.duration.waitSeconds).toBeCloseTo(0.0005, 6);
  });
});
