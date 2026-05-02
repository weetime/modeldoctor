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

  it("byTool('genai-perf') returns the genai-perf adapter", () => {
    expect(byTool("genai-perf").name).toBe("genai-perf");
  });

  it("allAdapters returns three adapters", () => {
    const all = allAdapters();
    expect(all).toHaveLength(3);
    expect(all.map((a) => a.name).sort()).toEqual(["genai-perf", "guidellm", "vegeta"].sort());
  });
});
