import { describe, expect, it } from "vitest";
import { tgiManifest } from "../tgi.js";

describe("tgi manifest", () => {
  it("declares 7 panels with unique keys", () => {
    expect(tgiManifest.metrics).toHaveLength(7);
    const keys = tgiManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses tgi_ prefix throughout", () => {
    for (const m of tgiManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/tgi_/);
      }
    }
  });

  it("snapshot of rendered PromQL is stable", () => {
    const rendered = tgiManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replaceAll("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
