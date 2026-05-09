import { describe, expect, it } from "vitest";
import { formatPanelValue } from "./format-unit.js";

describe("formatPanelValue (charts library)", () => {
  it("ms shows integer ms with unit", () => {
    expect(formatPanelValue(187.4, "ms")).toBe("187 ms");
  });
  it("ratio shows percentage", () => {
    expect(formatPanelValue(0.954, "ratio")).toBe("95.4%");
  });
  it("% shows fixed-1 percent", () => {
    expect(formatPanelValue(76.92, "%")).toBe("76.9%");
  });
  it("tps abbreviates large counts", () => {
    expect(formatPanelValue(1234, "tps")).toBe("1.2k tps");
  });
  it("count is integer", () => {
    expect(formatPanelValue(42.7, "count")).toBe("43");
  });
  it("returns dash for null", () => {
    expect(formatPanelValue(null, "ms")).toBe("—");
  });
});
