import { describe, expect, it } from "vitest";
import { ModalityCategorySchema, type ModalityCategory } from "./modality.js";

describe("ModalityCategorySchema", () => {
  it("accepts each of the 5 known categories", () => {
    for (const c of ["chat", "audio", "embeddings", "rerank", "image"] as ModalityCategory[]) {
      expect(ModalityCategorySchema.parse(c)).toBe(c);
    }
  });

  it("rejects unknown values", () => {
    expect(() => ModalityCategorySchema.parse("video")).toThrow();
  });
});
