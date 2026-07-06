import { describe, expect, it } from "vitest";
import { tau2Adapter } from "./runtime.js";

const summary = {
  kind: "agent-tau2",
  userSimModel: "deepseek-v3",
  numTrials: 2,
  overall: { pass1: 0.4, passK: 0.3, tasks: 30 },
  perDomain: { airline: { pass1: 0.4, passK: 0.3, tasks: 30 } },
  attribution: { wrong_action: 1.0 },
  highlights: { successSimId: "s1", successDomain: "airline", failureSimId: "s2", failureDomain: "airline" },
};

describe("tau2Adapter", () => {
  it("has name tau2 bound to agent scenario", () => {
    expect(tau2Adapter.name).toBe("tau2");
    expect(tau2Adapter.scenarios).toContain("agent");
  });
  it("readMetric always returns null (agent metrics are not inference-shaped)", () => {
    expect(tau2Adapter.readMetric("ttft.p50", summary as any)).toBeNull();
  });
  it("parseFinalReport maps summary.json into the report union", () => {
    const files = { summary: Buffer.from(JSON.stringify(summary)) };
    const r = tau2Adapter.parseFinalReport("", files);
    expect(r.tool).toBe("tau2");
    expect((r.data as any).overall.tasks).toBe(30);
  });
  it("parseFinalReport throws a clear error when summary missing", () => {
    expect(() => tau2Adapter.parseFinalReport("", {})).toThrow(/summary/i);
  });
});
