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

  it("byTool('kv-cache-stress') returns the kv-cache-stress adapter", () => {
    expect(byTool("kv-cache-stress").name).toBe("kv-cache-stress");
  });

  it("byTool('evalscope') returns the evalscope adapter", () => {
    expect(byTool("evalscope").name).toBe("evalscope");
  });

  it("allAdapters returns six adapters", () => {
    const all = allAdapters();
    expect(all).toHaveLength(6);
    expect(all.map((a) => a.name).sort()).toEqual(
      [
        "evalscope",
        "genai-perf",
        "guidellm",
        "kv-cache-stress",
        "prefix-cache-probe",
        "vegeta",
      ].sort(),
    );
  });
});
