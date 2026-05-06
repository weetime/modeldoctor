import { describe, expect, it } from "vitest";
import { migrateVegetaParams } from "./migrate-params.js";

describe("migrateVegetaParams", () => {
  it("fills missing path + body from apiType + model (legacy benchmark)", () => {
    const out = migrateVegetaParams(
      { apiType: "embeddings", rate: 10, duration: 30 },
      "bge-m3",
    );
    expect(out.apiType).toBe("embeddings");
    expect(out.path).toBe("/v1/embeddings");
    expect(JSON.parse(out.body)).toEqual({ model: "bge-m3", input: "hello" });
  });

  it("preserves path + body when already present", () => {
    const out = migrateVegetaParams(
      {
        apiType: "embeddings",
        rate: 10,
        duration: 30,
        path: "/embeddings",
        body: '{"model":"x","input":"y"}',
      },
      "bge-m3",
    );
    expect(out.path).toBe("/embeddings");
    expect(out.body).toBe('{"model":"x","input":"y"}');
  });

  it("uses '<unknown>' as model fallback when none supplied", () => {
    const out = migrateVegetaParams({ apiType: "chat", rate: 1, duration: 5 }, null);
    expect(JSON.parse(out.body).model).toBe("<unknown>");
  });
});
