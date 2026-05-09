import { describe, expect, it } from "vitest";
import { vllmManifest } from "../vllm.js";

describe("vllm manifest", () => {
  it("declares 19 panels with unique keys", () => {
    expect(vllmManifest.metrics).toHaveLength(19);
    const keys = vllmManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every metric has at least one PromQL variant; model-scoped metrics use the placeholder", () => {
    // Process-level metrics (e.g. process_resident_memory_bytes) don't carry
    // a model_name label, so they don't reference ${model}. Whitelist them.
    const PROCESS_LEVEL = new Set(["python_gc_memory"]);
    for (const m of vllmManifest.metrics) {
      expect(m.promql.length).toBeGreaterThan(0);
      if (PROCESS_LEVEL.has(m.key)) continue;
      for (const v of m.promql) {
        expect(v.expr).toMatch(/\$\{model\}/);
      }
    }
  });

  it("has V0/V1 dual variants for both prefix-cache metrics", () => {
    for (const key of ["prefix_cache_hit_rate", "prefix_cache_savings"]) {
      const m = vllmManifest.metrics.find((x) => x.key === key);
      expect(m).toBeDefined();
      const tags = (m?.promql ?? []).map((v) => v.tag);
      expect(tags).toEqual(expect.arrayContaining(["v1", "v0"]));
    }
  });

  it("topline group has 5 panels", () => {
    const topline = vllmManifest.metrics.filter((m) => m.group === "topline");
    expect(topline).toHaveLength(5);
  });

  it("snapshot of all rendered PromQL strings is stable", () => {
    const rendered = vllmManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replace("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
