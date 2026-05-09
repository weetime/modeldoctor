import { describe, expect, it } from "vitest";
import { vllmManifest } from "../vllm.js";

describe("vllm manifest", () => {
  it("declares 19 panels with unique keys", () => {
    expect(vllmManifest.metrics).toHaveLength(19);
    const keys = vllmManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every metric has at least one PromQL variant", () => {
    for (const m of vllmManifest.metrics) {
      expect(m.promql.length).toBeGreaterThan(0);
      for (const v of m.promql) {
        expect(v.expr).toMatch(/\$\{model\}/);
      }
    }
  });

  it("has V0/V1 dual variants for prefix-cache metrics", () => {
    const prefix = vllmManifest.metrics.find((m) => m.key === "prefix_cache_hit_rate");
    expect(prefix).toBeDefined();
    const tags = (prefix?.promql ?? []).map((v) => v.tag);
    expect(tags).toEqual(expect.arrayContaining(["v1", "v0"]));
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
