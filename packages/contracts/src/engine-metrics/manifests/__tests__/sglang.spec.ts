import { describe, expect, it } from "vitest";
import { sglangManifest } from "../sglang.js";

describe("sglang manifest", () => {
  it("declares 9 panels with unique keys", () => {
    expect(sglangManifest.metrics).toHaveLength(9);
    const keys = sglangManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every PromQL expr contains the model placeholder + sglang prefix", () => {
    for (const m of sglangManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/\$\{model\}/);
        expect(v.expr).toMatch(/sglang:/);
      }
    }
  });

  it("snapshot of rendered PromQL is stable", () => {
    const rendered = sglangManifest.metrics.map((m) => ({
      key: m.key,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: PromQL placeholder
      exprs: m.promql.map((v) => v.expr.replaceAll("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
