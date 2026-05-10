import { describe, expect, it } from "vitest";
import type { InferenceConfidence } from "@modeldoctor/contracts";
import { inferServerKind } from "./server-kind.js";
import type {
  MetricsProbeData,
  ProbeResult,
  ServerHeaderProbeData,
} from "../probes/index.js";

const okMetrics = (body: string): ProbeResult<MetricsProbeData> => ({
  ok: true,
  durationMs: 100,
  data: { body },
});

const okHeader = (
  server: string | null,
  poweredBy: string | null = null,
): ProbeResult<ServerHeaderProbeData> => ({
  ok: true,
  durationMs: 50,
  data: { server, poweredBy },
});

const failed = <T = unknown>(): ProbeResult<T> => ({ ok: false, durationMs: 10, reason: "404" });

describe("inferServerKind", () => {
  it("certain: vllm metric prefix detected", () => {
    const r = inferServerKind({
      metricsR: okMetrics("# HELP vllm:gpu_cache_usage_perc ...\nvllm:gpu_cache_usage_perc 0.5\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("vllm");
    expect(r.confidence).toBe<InferenceConfidence>("certain");
    expect(r.evidence).toMatch(/vllm:/);
  });

  it("certain: sglang prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("sglang:num_running_reqs 5\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("sglang");
  });

  it("certain: tgi underscore prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("tgi_queue_size 3\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("tgi");
  });

  it("certain: tei prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("te_request_count 100\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("tei");
  });

  it("certain: mindie prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("mindie:requests_total 42\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("mindie");
  });

  it("likely: Server header contains higress", () => {
    const r = inferServerKind({
      metricsR: failed(),
      serverHeaderR: okHeader("higress/2.0.0"),
      modelsR: failed(),
    });
    expect(r.value).toBe("higress");
    expect(r.confidence).toBe<InferenceConfidence>("likely");
  });

  it("likely: Server header contains vllm even without /metrics", () => {
    const r = inferServerKind({
      metricsR: failed(),
      serverHeaderR: okHeader("vllm/0.6.4"),
      modelsR: failed(),
    });
    expect(r.value).toBe("vllm");
    expect(r.confidence).toBe<InferenceConfidence>("likely");
  });

  it("unknown when nothing matches", () => {
    const r = inferServerKind({
      metricsR: okMetrics("unrelated_metric 1\n"),
      serverHeaderR: okHeader("nginx/1.21"),
      modelsR: failed(),
    });
    expect(r.value).toBeNull();
    expect(r.confidence).toBe<InferenceConfidence>("unknown");
  });

  it("metrics signal beats header signal", () => {
    const r = inferServerKind({
      metricsR: okMetrics("vllm:something 1\n"),
      serverHeaderR: okHeader("envoy"),
      modelsR: failed(),
    });
    expect(r.value).toBe("vllm");
    expect(r.confidence).toBe<InferenceConfidence>("certain");
  });
});
