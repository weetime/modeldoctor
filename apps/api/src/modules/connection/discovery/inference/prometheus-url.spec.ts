import type { InferenceConfidence } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import type { MetricsProbeData, ProbeResult } from "../probes/index.js";
import { inferPrometheusUrl } from "./prometheus-url.js";

const okMetrics = (body: string): ProbeResult<MetricsProbeData> => ({
  ok: true,
  durationMs: 10,
  data: { body },
});
const failed = (): ProbeResult<MetricsProbeData> => ({ ok: false, durationMs: 5, reason: "404" });

describe("inferPrometheusUrl", () => {
  it("likely: /metrics 200 with known engine prefix → suggest baseUrl", () => {
    const r = inferPrometheusUrl({
      baseUrl: "http://10.0.0.1:8000",
      metricsR: okMetrics("vllm:something 1\n"),
    });
    expect(r.value).toBe("http://10.0.0.1:8000");
    expect(r.confidence).toBe<InferenceConfidence>("likely");
  });

  it("guess: /metrics 200 but unrecognized format", () => {
    const r = inferPrometheusUrl({
      baseUrl: "http://10.0.0.1:8000",
      metricsR: okMetrics("some_unrelated_metric 1\n"),
    });
    expect(r.value).toBe("http://10.0.0.1:8000");
    expect(r.confidence).toBe<InferenceConfidence>("guess");
  });

  it("unknown: /metrics non-200", () => {
    const r = inferPrometheusUrl({
      baseUrl: "http://10.0.0.1:8000",
      metricsR: failed(),
    });
    expect(r.value).toBeNull();
    expect(r.confidence).toBe<InferenceConfidence>("unknown");
  });
});
