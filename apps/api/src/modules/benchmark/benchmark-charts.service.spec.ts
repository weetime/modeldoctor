import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";

// Project convention: use CJS __dirname (apps/api uses module: commonjs).
// See apps/api/src/integrations/probes/asr.ts for the same pattern.
function readFixtureBase64(rel: string): string {
  return fs.readFileSync(path.join(__dirname, "__fixtures__", rel)).toString("base64");
}

const guidellmFile = readFixtureBase64("guidellm-with-requests.json");
const vegetaFile = readFixtureBase64("vegeta-attack.ndjson");

function makeRow(tool: string, files: Record<string, string> | null) {
  return {
    id: "r1",
    tool,
    status: "completed",
    rawOutput: files ? { stdout: "", stderr: "", files } : null,
  } as const;
}

describe("BenchmarkChartsService", () => {
  const svc = new BenchmarkChartsService();

  describe("guidellm", () => {
    it("extracts CDF samples in milliseconds + 30-bucket TTFT histogram", () => {
      const result = svc.extract(makeRow("guidellm", { report: guidellmFile }));
      expect(result.latencyCdf?.samples).toEqual([12, 15, 18, 20, 25]);
      expect(result.ttftHistogram?.buckets).toHaveLength(30);
      const totalCount =
        result.ttftHistogram?.buckets.reduce((s: number, b: { count: number }) => s + b.count, 0) ??
        0;
      expect(totalCount).toBe(5);
      // Buckets should span min..max of TTFT samples (100..200)
      const first = result.ttftHistogram?.buckets[0];
      const last = result.ttftHistogram?.buckets[29];
      expect(first?.lower).toBeCloseTo(100, 5);
      expect(last?.upper).toBeCloseTo(200, 5);
    });

    it("returns both nulls when report file is absent", () => {
      const result = svc.extract(makeRow("guidellm", {}));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });

    it("returns both nulls when report JSON is malformed", () => {
      const bad = Buffer.from("{not json", "utf8").toString("base64");
      const result = svc.extract(makeRow("guidellm", { report: bad }));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });

  describe("vegeta", () => {
    it("extracts CDF samples in milliseconds (ns ÷ 1e6) and null histogram", () => {
      const result = svc.extract(makeRow("vegeta", { latencies: vegetaFile }));
      expect(result.latencyCdf?.samples).toEqual([12, 15, 18.5, 42, 11]);
      expect(result.ttftHistogram).toBeNull();
    });

    it("skips lines that are not valid JSON without throwing", () => {
      const mixed = Buffer.from(
        '{"latency":1000000}\nNOT JSON\n{"latency":2000000}\n',
        "utf8",
      ).toString("base64");
      const result = svc.extract(makeRow("vegeta", { latencies: mixed }));
      expect(result.latencyCdf?.samples).toEqual([1, 2]);
    });

    it("returns null latencyCdf when attack.ndjson is absent (old Run)", () => {
      const result = svc.extract(makeRow("vegeta", {}));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });

  describe("unknown tool / null rawOutput", () => {
    it("returns both nulls for unknown tool", () => {
      const result = svc.extract(makeRow("e2e", { report: guidellmFile }));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });

    it("returns both nulls when rawOutput is null", () => {
      const result = svc.extract(makeRow("guidellm", null));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });

  describe("non-terminal Run", () => {
    it("returns both nulls when status is not terminal", () => {
      const row = { ...makeRow("guidellm", { report: guidellmFile }), status: "running" };
      const result = svc.extract(row);
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });
});
