import type { EngineMetricsSnapshotResponse } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { reduceEngineSnapshot } from "./engine-metrics-snapshot.reduce.js";

function resp(panels: EngineMetricsSnapshotResponse["panels"]): EngineMetricsSnapshotResponse {
  return {
    engineId: "vllm",
    capability: "generative",
    window: { from: "2026-06-24T00:00:00.000Z", to: "2026-06-24T00:05:00.000Z", step: 15 },
    panels,
  } as EngineMetricsSnapshotResponse;
}

describe("reduceEngineSnapshot", () => {
  it("computes avg + peak over the window samples and stamps capturedAt = window.to", () => {
    const out = reduceEngineSnapshot(
      resp([
        {
          key: "kv_cache_usage",
          unit: "%",
          unavailable: false,
          series: [
            {
              samples: [
                [1, 10],
                [2, 40],
                [3, 70],
              ],
            },
          ],
        },
      ]),
      ["kv_cache_usage"],
    );
    expect(out.capturedAt).toBe("2026-06-24T00:05:00.000Z");
    expect(out.metrics).toHaveLength(1);
    expect(out.metrics[0]).toMatchObject({ key: "kv_cache_usage", unit: "%", avg: 40, peak: 70 });
  });

  it("flattens multi-series (per-pod) into one avg/peak", () => {
    const out = reduceEngineSnapshot(
      resp([
        {
          key: "preemption_rate",
          unit: "rps",
          unavailable: false,
          series: [
            {
              label: "pod-0",
              samples: [
                [1, 2],
                [2, 4],
              ],
            },
            {
              label: "pod-1",
              samples: [
                [1, 0],
                [2, 6],
              ],
            },
          ],
        },
      ]),
      ["preemption_rate"],
    );
    // values 2,4,0,6 → avg 3, peak 6
    expect(out.metrics[0]).toMatchObject({ avg: 3, peak: 6 });
  });

  it("drops unavailable / empty / non-finite panels and unselected keys", () => {
    const out = reduceEngineSnapshot(
      resp([
        { key: "kv_cache_usage", unit: "%", unavailable: true, reason: "no_data", series: [] },
        { key: "ttft_p99", unit: "ms", unavailable: false, series: [{ samples: [] }] },
        {
          key: "success_rate",
          unit: "ratio",
          unavailable: false,
          series: [
            {
              samples: [
                [1, Number.NaN],
                [2, Number.POSITIVE_INFINITY],
              ],
            },
          ],
        },
        {
          key: "system_efficiency",
          unit: "ratio",
          unavailable: false,
          series: [{ samples: [[1, 0.8]] }],
        },
      ]),
      ["kv_cache_usage", "ttft_p99", "success_rate", "system_efficiency", "preemption_rate"],
    );
    // only system_efficiency survives (others unavailable/empty/non-finite/missing)
    expect(out.metrics).toHaveLength(1);
    expect(out.metrics[0]).toMatchObject({ key: "system_efficiency", avg: 0.8, peak: 0.8 });
  });
});
