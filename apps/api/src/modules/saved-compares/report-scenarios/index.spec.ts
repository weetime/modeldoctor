import { describe, expect, it } from "vitest";
import { resolveReportIntent } from "./index.js";

describe("resolveReportIntent", () => {
  it("maps lb-strategy directly", () => {
    expect(resolveReportIntent("lb-strategy", 2)).toBe("lb-strategy");
  });
  it("splits inference by run count", () => {
    expect(resolveReportIntent("inference", 1)).toBe("inference-single");
    expect(resolveReportIntent("inference", 3)).toBe("inference-multi");
  });
  it("falls back to default on null/unknown scenario", () => {
    expect(resolveReportIntent(null, 2)).toBe("default");
    expect(resolveReportIntent("nonsense", 2)).toBe("default");
  });
});
