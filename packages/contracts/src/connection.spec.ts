import { describe, expect, it } from "vitest";
import { createConnectionSchema } from "./connection.js";

const validBase = {
  name: "vllm-prod",
  baseUrl: "http://10.0.0.1:8000",
  model: "qwen2.5",
  customHeaders: "",
  queryParams: "",
  category: "chat" as const,
  tags: [],
};

describe("createConnectionSchema — apiKey validation", () => {
  it("accepts a normal apiKey", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test-abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty apiKey", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with newline (control character)", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test\nwith-newline",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with tab character (control character)", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test\twith-tab",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with leading whitespace", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: " sk-test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with trailing whitespace", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test ",
    });
    expect(result.success).toBe(false);
  });

  it("accepts apiKey with shell metacharacters (POSIX-safe via parameter expansion)", () => {
    // POSIX 2.6.5: parameter expansion result is not re-parsed.
    // These chars are safe in sh -c '... "$VAR" ...'; testing them
    // at the schema layer confirms we don't over-reject real-world keys.
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: 'sk-test$(rm)`backtick`"quote',
    });
    expect(result.success).toBe(true);
  });
});
