import { describe, expect, it } from "vitest";
import { formatLatencyMs, formatPct, formatPercentFromFraction, formatThroughput } from "./format";

describe("formatLatencyMs", () => {
  it("renders ≥100 ms with 0 decimals", () => {
    expect(formatLatencyMs(831.2)).toBe("831 ms");
    expect(formatLatencyMs(1242.34)).toBe("1242 ms");
    expect(formatLatencyMs(100)).toBe("100 ms");
    expect(formatLatencyMs(9109.121569219998)).toBe("9109 ms");
  });
  it("renders <100 ms with 1 decimal", () => {
    expect(formatLatencyMs(13.2)).toBe("13.2 ms");
    expect(formatLatencyMs(99.94)).toBe("99.9 ms");
    expect(formatLatencyMs(0)).toBe("0.0 ms");
  });
  it("renders null as em dash", () => {
    expect(formatLatencyMs(null)).toBe("—");
  });
});

describe("formatPercentFromFraction", () => {
  it("scales 0-1 fraction to percent with 1 decimal", () => {
    expect(formatPercentFromFraction(0.2397)).toBe("24.0%");
    expect(formatPercentFromFraction(0.0676)).toBe("6.8%");
    expect(formatPercentFromFraction(0)).toBe("0.0%");
    expect(formatPercentFromFraction(1)).toBe("100.0%");
  });
  it("renders null as em dash", () => {
    expect(formatPercentFromFraction(null)).toBe("—");
  });
});

describe("formatPct", () => {
  it("renders a 0-100 value with 1 decimal", () => {
    expect(formatPct(57.21)).toBe("57.2%");
    expect(formatPct(8)).toBe("8.0%");
    expect(formatPct(null)).toBe("—");
  });
});

describe("formatThroughput", () => {
  it("renders req/s with 1 decimal", () => {
    expect(formatThroughput(1.23)).toBe("1.2 req/s");
    expect(formatThroughput(null)).toBe("—");
  });
});
