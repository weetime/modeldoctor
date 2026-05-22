import { describe, expect, it } from "vitest";
import { ENGINE_METRIC_NAMESPACE } from "./engine-metrics/manifests/index.js";
import {
  engineMetricsSnapshotQuerySchema,
  engineMetricsSnapshotResponseSchema,
  panelUnitSchema,
} from "./engine-metrics.js";

describe("engine-metrics zod schemas", () => {
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

  it("snapshot response shape: engineId / capability / panels (no panel/group fields)", () => {
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
          unit: "ms",
          unavailable: false,
          series: [{ samples: [[1715212800, 187.4]] }],
        },
        {
          key: "kv_cache_usage",
          unit: "%",
          unavailable: true,
          reason: "no_data",
          series: [],
        },
        {
          key: "success_rate",
          unit: "ratio",
          thresholds: [
            { at: 0.95, severity: "ok" },
            { at: 0.9, severity: "warn" },
            { at: 0, severity: "crit" },
          ],
          unavailable: false,
          series: [{ samples: [[1715212800, 0.99]] }],
        },
      ],
    });
    expect(ok.panels).toHaveLength(3);
    expect(ok.panels[2].thresholds).toHaveLength(3);
  });
});

describe("ENGINE_METRIC_NAMESPACE", () => {
  it("maps each supported engine to its Prometheus prefix", () => {
    expect(ENGINE_METRIC_NAMESPACE.vllm).toBe("vllm:");
    expect(ENGINE_METRIC_NAMESPACE.sglang).toBe("sglang:");
    expect(ENGINE_METRIC_NAMESPACE.tgi).toBe("tgi_");
    expect(ENGINE_METRIC_NAMESPACE.tei).toBe("te_");
    expect(ENGINE_METRIC_NAMESPACE.mindie).toBe("mindie:");
  });

  it("covers exactly the supported engines", () => {
    expect(Object.keys(ENGINE_METRIC_NAMESPACE).sort()).toEqual(
      ["mindie", "sglang", "tei", "tgi", "vllm"].sort(),
    );
  });
});
