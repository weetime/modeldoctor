import { describe, expect, it } from "vitest";
import { inferManifest } from "../infer.js";

describe("inferManifest (normalized infer:* manifest)", () => {
  it("has unique metric keys", () => {
    const keys = inferManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every metric queries the normalized infer:* namespace and is model-scoped", () => {
    for (const metric of inferManifest.metrics) {
      expect(metric.promql.length).toBeGreaterThan(0);
      for (const variant of metric.promql) {
        // Normalization lives in the recording rules — the manifest must only
        // reference infer:* series, never raw vllm:/sglang:/tgi_ metrics.
        expect(variant.expr).toContain("infer:");
        expect(variant.expr).not.toMatch(/\bvllm:/);
        expect(variant.expr).not.toMatch(/\bsglang[:_]/);
        // model-scoped so fetchSnapshot's ${model} substitution filters by model.
        // biome-ignore lint/suspicious/noTemplateCurlyInString: PromQL template placeholder
        expect(variant.expr).toContain('model_name="${model}"');
      }
    }
  });

  it("covers the keys the compare snapshot reduces", () => {
    // Mirror of COMPARE_ENGINE_METRIC_KEYS (apps/api engine-metrics-snapshot.reduce.ts).
    const compareKeys = [
      "success_rate",
      "system_efficiency",
      "ttft_p99",
      "preemption_rate",
      "kv_cache_usage",
      "prefix_cache_hit_rate",
      "request_queue_time",
    ];
    const keys = new Set(inferManifest.metrics.map((m) => m.key));
    for (const k of compareKeys) expect(keys.has(k)).toBe(true);
  });
});
