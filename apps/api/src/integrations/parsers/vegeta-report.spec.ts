import { describe, it, expect } from "vitest";
import { parseVegetaReport } from "./vegeta-report.js";

// Realistic Vegeta stdout (captured format). The parser was ported verbatim
// from the legacy CJS source, so assertions here reflect *actual* legacy
// behaviour, not the plan's template placeholders:
//   - `success` is a percent (100 for "100.00%"), NOT a 0-1 ratio.
//   - Latency values keep their unit suffix ("45.6ms").
const SAMPLE = `Requests      [total, rate, throughput]             10, 10.01, 9.87
Duration      [total, attack, wait]                1.013s, 999.062ms, 14.164ms
Latencies     [min, mean, 50, 90, 95, 99, max]     12.3ms, 45.6ms, 40ms, 60ms, 70ms, 100ms, 120ms
Bytes In      [total, mean]                        5000, 500.00
Bytes Out     [total, mean]                        1500, 150.00
Success       [ratio]                              100.00%
Status Codes  [code:count]                         200:10
Error Set:
`;

describe("parseVegetaReport", () => {
  it("extracts requests, throughput, success percent, and latency percentiles", () => {
    const parsed = parseVegetaReport(SAMPLE);
    expect(parsed.requests).toBe(10);
    expect(parsed.rate).toBeCloseTo(10.01, 2);
    expect(parsed.throughput).toBeCloseTo(9.87, 2);
    // Legacy parser: "100.00%" -> 100 (percent), NOT 1 (ratio).
    expect(parsed.success).toBe(100);
    expect(parsed.duration).toBe("1.013s");
    expect(parsed.bytesIn).toBe(5000);
    expect(parsed.bytesOut).toBe(1500);
    expect(parsed.latencies.min).toBe("12.3ms");
    expect(parsed.latencies.mean).toBe("45.6ms");
    expect(parsed.latencies.p50).toBe("40ms");
    expect(parsed.latencies.p90).toBe("60ms");
    expect(parsed.latencies.p95).toBe("70ms");
    expect(parsed.latencies.p99).toBe("100ms");
    expect(parsed.latencies.max).toBe("120ms");
    expect(parsed.statusCodes).toEqual({ "200": 10 });
  });

  it("returns nulls for fields missing from malformed input", () => {
    const parsed = parseVegetaReport("garbage");
    expect(parsed.requests).toBeNull();
    expect(parsed.rate).toBeNull();
    expect(parsed.throughput).toBeNull();
    expect(parsed.duration).toBeNull();
    expect(parsed.success).toBeNull();
    expect(parsed.bytesIn).toBeNull();
    expect(parsed.bytesOut).toBeNull();
    expect(parsed.latencies.min).toBeNull();
    expect(parsed.latencies.mean).toBeNull();
    expect(parsed.latencies.p50).toBeNull();
    expect(parsed.latencies.p95).toBeNull();
    expect(parsed.latencies.p99).toBeNull();
    expect(parsed.latencies.max).toBeNull();
    expect(parsed.statusCodes).toEqual({});
  });
});
