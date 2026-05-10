import { describe, expect, it } from "vitest";
import { inferTags } from "./tags.js";

describe("inferTags", () => {
  it("includes serverKind and category names", () => {
    const r = inferTags({ serverKind: "vllm", category: "chat", models: [] });
    expect(r.values).toContain("vllm");
    expect(r.values).toContain("chat");
  });

  it("extracts model size from id", () => {
    const r = inferTags({
      serverKind: "vllm",
      category: "chat",
      models: ["llama-3-70b-instruct"],
    });
    expect(r.values).toContain("70b");
  });

  it("extracts model form-factor (instruct/chat/base/code/math)", () => {
    expect(
      inferTags({ serverKind: null, category: null, models: ["llama-instruct"] }).values,
    ).toContain("instruct");
    expect(
      inferTags({ serverKind: null, category: null, models: ["my-base-model"] }).values,
    ).toContain("base");
    expect(
      inferTags({ serverKind: null, category: null, models: ["code-llama-7b"] }).values,
    ).toContain("code");
    expect(
      inferTags({ serverKind: null, category: null, models: ["llema-math-3b"] }).values,
    ).toContain("math");
  });

  it("extracts quantization (awq/gptq/fp8/int4)", () => {
    expect(
      inferTags({ serverKind: null, category: null, models: ["llama-7b-awq"] }).values,
    ).toContain("awq");
    expect(
      inferTags({ serverKind: null, category: null, models: ["model-gptq"] }).values,
    ).toContain("gptq");
    expect(
      inferTags({ serverKind: null, category: null, models: ["model-fp8"] }).values,
    ).toContain("fp8");
    expect(
      inferTags({ serverKind: null, category: null, models: ["model-int4"] }).values,
    ).toContain("int4");
  });

  it("returns up to 8 tags, deduplicated", () => {
    const r = inferTags({
      serverKind: "vllm",
      category: "chat",
      models: ["llama-3-70b-instruct-awq", "llama-3-70b-instruct-awq", "llama-3-70b-instruct-awq"],
    });
    expect(r.values.length).toBeLessThanOrEqual(8);
    expect(new Set(r.values).size).toBe(r.values.length);
  });

  it("returns guess confidence", () => {
    const r = inferTags({ serverKind: "vllm", category: "chat", models: [] });
    expect(r.confidence).toBe("guess");
  });

  it("empty when no inputs at all", () => {
    const r = inferTags({ serverKind: null, category: null, models: [] });
    expect(r.values).toEqual([]);
    expect(r.confidence).toBe("unknown");
  });
});
