import { describe, expect, it } from "vitest";
import { allAdapters, byTool } from "./registry.js";

describe("registry", () => {
  it("byTool('guidellm') returns the guidellm adapter", () => {
    const a = byTool("guidellm");
    expect(a.name).toBe("guidellm");
    expect(typeof a.paramsSchema.parse).toBe("function");
  });

  it("byTool('vegeta') returns the vegeta adapter", () => {
    expect(byTool("vegeta").name).toBe("vegeta");
  });

  it("byTool('evalscope') returns the evalscope adapter", () => {
    expect(byTool("evalscope").name).toBe("evalscope");
  });

  it("byTool('aiperf') returns the aiperf adapter", () => {
    expect(byTool("aiperf").name).toBe("aiperf");
  });

  it("byTool('tau3') returns the tau3 adapter", () => {
    expect(byTool("tau3").name).toBe("tau3");
  });

  it("allAdapters returns five adapters", () => {
    const all = allAdapters();
    expect(all).toHaveLength(5);
    expect(all.map((a) => a.name).sort()).toEqual(
      ["aiperf", "evalscope", "guidellm", "tau3", "vegeta"].sort(),
    );
  });
});
