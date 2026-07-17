import type { MetricKind } from "../core/metric-extractor.js";
import type { VllmOmniBenchReport } from "./schema.js";

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

type Curve = VllmOmniBenchReport["curve"];
type Point = Curve[number];

function shape(data: Record<string, unknown>): VllmOmniBenchReport | null {
  const curve = data.curve as Curve | undefined;
  const derived = data.derived as VllmOmniBenchReport["derived"] | undefined;
  if (!Array.isArray(curve) || !derived) return null;
  return data as unknown as VllmOmniBenchReport;
}

function audioOk(r: VllmOmniBenchReport): Point[] {
  return r.curve.filter((p) => p.arm === "audio" && p.status === "ok");
}

// C1 = 最低并发的 audio 点;peak = derived.peakConcurrency 对应的 audio 点。
function c1Point(r: VllmOmniBenchReport): Point | undefined {
  return audioOk(r).sort((a, b) => a.concurrency - b.concurrency)[0];
}
function peakPoint(r: VllmOmniBenchReport): Point | undefined {
  return audioOk(r).find((p) => p.concurrency === r.derived.peakConcurrency);
}

export function vllmOmniBenchReadMetric(
  kind: MetricKind,
  data: Record<string, unknown>,
): number | null {
  const r = shape(data);
  if (!r) return null;
  const peak = peakPoint(r);
  switch (kind) {
    case "realtimeCeiling":
      return fin(r.derived.realtimeCeiling);
    case "audioTtfpC1.mean":
      return fin(c1Point(r)?.audioTtfpMs?.mean);
    case "audioTtfpPeak.p50":
      return fin(peak?.audioTtfpMs?.p50);
    case "audioTtfpPeak.p99":
      return fin(peak?.audioTtfpMs?.p99);
    case "audioRtfPeak.mean":
      return fin(peak?.audioRtf?.mean);
    case "audioRtfPeak.p50":
      return fin(peak?.audioRtf?.p50);
    case "audioRtfPeak.p99":
      return fin(peak?.audioRtf?.p99);
    case "voiceTax.ms":
      return fin(r.derived.voiceTaxMs);
    case "ttft.p50":
      return fin(peak?.ttftMs?.p50);
    case "ttft.p99":
      return fin(peak?.ttftMs?.p99);
    case "e2e.p50":
      return fin(peak?.e2elMs?.p50);
    case "e2e.p99":
      return fin(peak?.e2elMs?.p99);
    case "requestsPerSec":
      return fin(peak?.reqPerSec);
    case "outputTokensPerSec":
      return fin(peak?.outTokPerSec);
    case "errorRate": {
      const failed = r.curve.filter((p) => p.status === "failed").length;
      return r.curve.length === 0 ? null : failed / r.curve.length;
    }
    case "tailRatio": {
      const p50 = fin(peak?.e2elMs?.p50);
      const p99 = fin(peak?.e2elMs?.p99);
      return p50 === null || p99 === null || p50 === 0 ? null : p99 / p50;
    }
    // bench 汇总没有这些分位/指标。
    case "ttft.p90":
    case "ttft.p95":
    case "itl.p50":
    case "itl.p95":
    case "e2e.p90":
    case "e2e.p95":
      return null;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}
