import { describe, expect, it } from "vitest";
import { mindieManifest } from "../mindie.js";

describe("mindie manifest", () => {
  it("declares 5 panels", () => {
    expect(mindieManifest.metrics).toHaveLength(5);
  });

  it("uses mindie_ prefix throughout + has model placeholder", () => {
    for (const m of mindieManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/mindie_/);
        expect(v.expr).toMatch(/\$\{model\}/);
      }
    }
  });

  it("snapshot is stable", () => {
    const rendered = mindieManifest.metrics.map((m) => ({
      key: m.key,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: PromQL placeholder
      exprs: m.promql.map((v) => v.expr.replaceAll("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
