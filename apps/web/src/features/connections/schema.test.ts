import { describe, expect, it } from "vitest";
import { connectionInputSchema } from "./schema";

describe("connectionInputSchema", () => {
  const valid = {
    name: "prod-vllm",
    apiBaseUrl: "http://10.0.0.1:8000",
    apiKey: "sk-abc",
    model: "qwen-2.5-7b",
    customHeaders: "",
    queryParams: "",
  };

  it("accepts a valid input", () => {
    expect(connectionInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = connectionInputSchema.safeParse({ ...valid, name: " " });
    expect(r.success).toBe(false);
  });

  it("rejects invalid URL", () => {
    const r = connectionInputSchema.safeParse({
      ...valid,
      apiBaseUrl: "not-a-url",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const r = connectionInputSchema.safeParse({ ...valid, apiKey: "" });
    expect(r.success).toBe(false);
  });

  it("rejects empty model", () => {
    const r = connectionInputSchema.safeParse({ ...valid, model: "" });
    expect(r.success).toBe(false);
  });

  it("normalizes name by trimming", () => {
    const r = connectionInputSchema.safeParse({
      ...valid,
      name: "  staging  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("staging");
  });
});
