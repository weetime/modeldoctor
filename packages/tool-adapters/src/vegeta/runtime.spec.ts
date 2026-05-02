import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCommand, parseFinalReport, parseProgress } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureBuf = fs.readFileSync(path.join(__dirname, "__fixtures__/report.txt"));

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
  });

  it("throws when 'report' file is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow();
  });
});
