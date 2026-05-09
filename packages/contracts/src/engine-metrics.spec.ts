import { describe, expect, it } from "vitest";
import {
  engineMetricsSnapshotQuerySchema,
  engineMetricsSnapshotResponseSchema,
  panelGroupSchema,
  panelKindSchema,
  panelUnitSchema,
} from "./engine-metrics.js";

describe("engine-metrics zod schemas", () => {
  it("panelKindSchema accepts known kinds", () => {
    for (const v of ["stat", "gauge", "timeseries", "heatmap"]) {
      expect(panelKindSchema.parse(v)).toBe(v);
    }
  });

  it("panelGroupSchema accepts known groups", () => {
    for (const v of ["topline", "latency", "throughput", "engine", "health"]) {
      expect(panelGroupSchema.parse(v)).toBe(v);
    }
  });

  it("panelUnitSchema accepts ms/s/%/ratio/tps/rps/count/bytes", () => {
    for (const v of ["ms", "s", "%", "ratio", "tps", "rps", "count", "bytes"]) {
      expect(panelUnitSchema.parse(v)).toBe(v);
    }
  });

  it("snapshot query requires from/to ISO and accepts step", () => {
    const ok = engineMetricsSnapshotQuerySchema.parse({
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
      step: 15,
    });
    expect(ok.step).toBe(15);
    expect(() => engineMetricsSnapshotQuerySchema.parse({ from: "garbage", to: "x" })).toThrow();
  });

  it("snapshot response shape: engineId / capability / panels", () => {
    const ok = engineMetricsSnapshotResponseSchema.parse({
      engineId: "vllm",
      capability: "generative",
      window: {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
        step: 15,
      },
      panels: [
        {
          key: "ttft_p99",
          group: "topline",
          panel: "stat",
          unit: "ms",
          unavailable: false,
          series: [{ samples: [[1715212800, 187.4]] }],
        },
        {
          key: "kv_cache_usage",
          group: "engine",
          panel: "timeseries",
          unit: "%",
          unavailable: true,
          reason: "no_data",
          series: [],
        },
      ],
    });
    expect(ok.panels).toHaveLength(2);
  });
});
