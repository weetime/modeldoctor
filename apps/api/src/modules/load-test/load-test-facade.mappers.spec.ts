import type { Run } from "@modeldoctor/contracts";
import type { VegetaReport } from "@modeldoctor/tool-adapters";
import { describe, expect, it } from "vitest";
import { legacyToCreateRun, runToLoadTestResponse } from "./load-test-facade.mappers.js";

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "conn-1",
    connection: { id: "conn-1", name: "conn" },
    kind: "benchmark",
    tool: "vegeta",
    scenario: { apiBaseUrl: "https://upstream/", model: "m" },
    mode: "fixed",
    driverKind: "local",
    name: "loadtest-x",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: "subprocess:1",
    params: {
      apiType: "chat",
      rate: 10,
      duration: 5,
    },
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    startedAt: "2024-01-01T00:00:01.000Z",
    completedAt: "2024-01-01T00:00:06.000Z",
    ...over,
  };
}

const sampleReport: VegetaReport = {
  requests: { total: 50, rate: 10, throughput: 9.8 },
  duration: { totalSeconds: 5.1, attackSeconds: 5.0, waitSeconds: 0.1 },
  latencies: { min: 1, mean: 25, p50: 22, p90: 40, p95: 48, p99: 80, max: 120 },
  bytesIn: { total: 1024, mean: 20.48 },
  bytesOut: { total: 2048, mean: 40.96 },
  success: 100,
  statusCodes: { "200": 50 },
  errors: [],
};

describe("legacyToCreateRun", () => {
  it("translates a LoadTestRequest into a CreateRunRequest with tool=vegeta, kind=benchmark", () => {
    const out = legacyToCreateRun(
      {
        connectionId: "conn-1",
        apiType: "chat",
        rate: 10,
        duration: 5,
      },
      "loadtest-2024",
    );

    expect(out.tool).toBe("vegeta");
    expect(out.kind).toBe("benchmark");
    expect(out.connectionId).toBe("conn-1");
    expect(out.name).toBe("loadtest-2024");
    expect(out.params).toEqual({
      apiType: "chat",
      rate: 10,
      duration: 5,
    });
  });

  it("defaults apiType to 'chat' when omitted (LoadTestRequest schema makes it optional)", () => {
    const out = legacyToCreateRun(
      {
        connectionId: "conn-1",
        rate: 5,
        duration: 3,
      },
      "n",
    );
    expect(out.params).toMatchObject({ apiType: "chat", rate: 5, duration: 3 });
  });
});

describe("runToLoadTestResponse", () => {
  it("unwraps {tool,data} envelope and formats latencies as Nms strings", () => {
    const out = runToLoadTestResponse(
      makeRun({
        summaryMetrics: { tool: "vegeta", data: sampleReport },
      }),
    );

    expect(out.success).toBe(true);
    expect(out.runId).toBe("r1");
    expect(out.parsed.requests).toBe(50);
    expect(out.parsed.success).toBe(100);
    expect(out.parsed.throughput).toBe(9.8);
    expect(out.parsed.latencies.mean).toBe("25ms");
    expect(out.parsed.latencies.p50).toBe("22ms");
    expect(out.parsed.latencies.p95).toBe("48ms");
    expect(out.parsed.latencies.p99).toBe("80ms");
    expect(out.parsed.latencies.max).toBe("120ms");
  });

  it("base64-decodes rawOutput.files.report into the legacy `report` text field", () => {
    const reportText = "Requests      [total, rate, throughput]   50, 10.00, 9.80\n";
    const reportB64 = Buffer.from(reportText, "utf8").toString("base64");
    const out = runToLoadTestResponse(
      makeRun({
        rawOutput: { stdout: "", stderr: "", files: { report: reportB64 } },
      }),
    );
    expect(out.report).toBe(reportText);
  });

  it("returns empty report and all-null parsed fields when summaryMetrics is null", () => {
    const out = runToLoadTestResponse(makeRun({ summaryMetrics: null, rawOutput: null }));

    expect(out.report).toBe("");
    expect(out.parsed.requests).toBeNull();
    expect(out.parsed.success).toBeNull();
    expect(out.parsed.throughput).toBeNull();
    expect(out.parsed.latencies.mean).toBeNull();
    expect(out.parsed.latencies.p50).toBeNull();
    expect(out.parsed.latencies.max).toBeNull();
  });

  it("returns null parsed fields when summaryMetrics is malformed (missing envelope)", () => {
    // RunCallbackController.handleFinish always writes `{ tool, data }`. A
    // raw VegetaReport without that envelope is by-contract malformed; the
    // mapper must not try to interpret it.
    const out = runToLoadTestResponse(
      makeRun({ summaryMetrics: sampleReport as unknown as Run["summaryMetrics"] }),
    );
    expect(out.parsed.requests).toBeNull();
    expect(out.parsed.latencies.mean).toBeNull();
  });

  it("populates config from scenario + params, falling back to safe defaults", () => {
    const out = runToLoadTestResponse(makeRun());
    expect(out.config.apiType).toBe("chat");
    expect(out.config.apiBaseUrl).toBe("https://upstream/");
    expect(out.config.model).toBe("m");
    expect(out.config.rate).toBe(10);
    expect(out.config.duration).toBe(5);
  });

  it("falls back to safe defaults when scenario/params are sparse", () => {
    const out = runToLoadTestResponse(makeRun({ scenario: {}, params: {} }));
    expect(out.config.apiType).toBe("chat");
    expect(out.config.apiBaseUrl).toBe("");
    expect(out.config.model).toBe("");
    expect(out.config.rate).toBe(0);
    expect(out.config.duration).toBe(0);
  });
});
