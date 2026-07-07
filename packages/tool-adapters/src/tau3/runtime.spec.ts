import { describe, expect, it } from "vitest";
import { tau3Adapter } from "./runtime.js";

const summary = {
  kind: "agent-tau3",
  userSimModel: "deepseek-v3",
  numTrials: 2,
  overall: { pass1: 0.4, passK: 0.3, tasks: 30 },
  perDomain: { airline: { pass1: 0.4, passK: 0.3, tasks: 30 } },
  attribution: { wrong_action: 1.0 },
  highlights: {
    successSimId: "s1",
    successDomain: "airline",
    failureSimId: "s2",
    failureDomain: "airline",
  },
};

describe("tau3Adapter", () => {
  it("has name tau3 bound to agent scenario", () => {
    expect(tau3Adapter.name).toBe("tau3");
    expect(tau3Adapter.scenarios).toContain("agent");
  });
  it("readMetric always returns null (agent metrics are not inference-shaped)", () => {
    expect(tau3Adapter.readMetric("ttft.p50", summary as any)).toBeNull();
  });
  it("parseFinalReport maps summary.json into the report union", () => {
    const files = { summary: Buffer.from(JSON.stringify(summary)) };
    const r = tau3Adapter.parseFinalReport("", files);
    expect(r.tool).toBe("tau3");
    expect((r.data as any).overall.tasks).toBe(30);
  });
  it("parseFinalReport throws a clear error when summary missing", () => {
    expect(() => tau3Adapter.parseFinalReport("", {})).toThrow(/summary/i);
  });
});
