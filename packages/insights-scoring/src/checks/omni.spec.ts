import { describe, expect, it } from "vitest";
import { ALL_CHECKS, getCheck } from "../descriptors.js";
import { evaluateSeverity } from "../evaluate.js";
import { omniChecks } from "./omni.js";

describe("omni checks", () => {
  it("registers 6 omni checks in ALL_CHECKS", () => {
    const ids = ALL_CHECKS.filter((c) => c.scenario === "omni").map((c) => c.id);
    expect(ids).toEqual([
      "omni.realtime_ceiling",
      "omni.audio_ttfp.c1.mean.ms",
      "omni.audio_ttfp.peak.p99.ms",
      "omni.audio_rtf.peak.mean",
      "omni.voice_tax.ms",
      "omni.error_rate",
    ]);
  });
  it("realtime ceiling is higher_is_better on the throughput axis", () => {
    const c = getCheck("omni.realtime_ceiling");
    expect(c?.direction).toBe("higher_is_better");
    expect(c?.axis).toBe("throughput");
    expect(c?.metricKind).toBe("realtimeCeiling");
  });
  it("all omni checks filter to the vllm-omni-bench tool", () => {
    for (const c of omniChecks) expect(c.toolFilter).toEqual(["vllm-omni-bench"]);
  });

  // Pins the exact evaluate.ts semantics for higher_is_better thresholds so
  // the default profile's { warn: 16, crit: 4 } values (seed.ts) are
  // verified, not assumed. evaluate.ts's higher_is_better branch treats
  // warn/crit as floors using <=: value <= crit -> crit, value <= warn ->
  // warn, else good. This mirrors the existing capacity.max_qps convention
  // (COMMON_THROUGHPUT_AND_CAPACITY_CHECKS in seed.ts: warn:20 > crit:10,
  // also higher_is_better).
  describe("realtime_ceiling threshold semantics ({ warn: 16, crit: 4 })", () => {
    const threshold = { warn: 16, crit: 4 };
    it("value below crit floor -> crit severity", () => {
      expect(evaluateSeverity(2, threshold, "higher_is_better")).toBe("crit");
    });
    it("value at crit floor -> crit severity (inclusive)", () => {
      expect(evaluateSeverity(4, threshold, "higher_is_better")).toBe("crit");
    });
    it("value between crit and warn floors -> warn severity", () => {
      expect(evaluateSeverity(10, threshold, "higher_is_better")).toBe("warn");
    });
    it("value at warn floor -> warn severity (inclusive)", () => {
      expect(evaluateSeverity(16, threshold, "higher_is_better")).toBe("warn");
    });
    it("value above warn floor -> good severity", () => {
      expect(evaluateSeverity(32, threshold, "higher_is_better")).toBe("good");
    });
  });
});
