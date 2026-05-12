import { describe, expect, it } from "vitest";
import { endpointCallResultSchema, listRunSamplesQuerySchema } from "../run-samples.js";

describe("endpointCallResultSchema", () => {
  it("accepts success shape", () => {
    expect(endpointCallResultSchema.parse({ rawAnswer: "hi", latencyMs: 200, tokensIn: 5, tokensOut: 1 })).toMatchObject({ latencyMs: 200 });
  });
  it("accepts error shape", () => {
    expect(endpointCallResultSchema.parse({ rawAnswer: "", latencyMs: 0, error: "timeout" })).toMatchObject({ error: "timeout" });
  });
});

describe("listRunSamplesQuerySchema", () => {
  it("defaults filter to 'all' and pageSize to 20", () => {
    const q = listRunSamplesQuerySchema.parse({});
    expect(q.filter).toBe("all");
    expect(q.pageSize).toBe(20);
  });
});
