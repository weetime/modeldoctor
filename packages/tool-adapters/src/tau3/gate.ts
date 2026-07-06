import type { Tau3Params } from "./schema.js";
import type { Tau3Report } from "./schema.js";

export type GateResult = { mode: string; result: "PASSED" | "WARNING" | "FAILED" | null; detail?: string };

export function computeGate(
  report: Tau3Report,
  gate: Tau3Params["gate"],
  baselineOverallPass1: number | null,
): GateResult {
  if (gate.mode === "off") return { mode: "off", result: null };

  if (gate.mode === "perDomainFloor") {
    const floors = gate.perDomainFloor ?? {};
    const failed = Object.entries(floors).filter(([d, floor]) => {
      const m = report.perDomain[d as keyof typeof report.perDomain];
      return m != null && m.pass1 < floor;
    });
    if (failed.length > 0) {
      return { mode: gate.mode, result: "FAILED",
        detail: failed.map(([d, f]) => `${d} pass^1<${f}`).join(", ") };
    }
    return { mode: gate.mode, result: "PASSED" };
  }

  // baselineRegression
  if (baselineOverallPass1 == null) {
    return { mode: gate.mode, result: null, detail: "no baseline" };
  }
  const dropPp = (baselineOverallPass1 - report.overall.pass1) * 100; // signed: negative = improvement
  const th = gate.baselineRegressionPp ?? 5;
  if (dropPp >= th) return { mode: gate.mode, result: "FAILED", detail: `-${dropPp.toFixed(1)}pp vs baseline` };
  if (dropPp >= th / 2) return { mode: gate.mode, result: "WARNING", detail: `-${dropPp.toFixed(1)}pp vs baseline` };
  return { mode: gate.mode, result: "PASSED", detail: `${dropPp <= 0 ? "+" : "-"}${Math.abs(dropPp).toFixed(1)}pp vs baseline` };
}
