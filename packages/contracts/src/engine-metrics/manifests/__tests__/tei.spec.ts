import { describe, expect, it } from "vitest";
import { teiManifest } from "../tei.js";

describe("tei manifest", () => {
  it("is embedding capability with 6 panels", () => {
    expect(teiManifest.capability).toBe("embedding");
    expect(teiManifest.metrics).toHaveLength(6);
  });

  it("uses te_ prefix in every PromQL", () => {
    for (const m of teiManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/te_/);
      }
    }
  });

  it("snapshot is stable", () => {
    const rendered = teiManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replaceAll("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
