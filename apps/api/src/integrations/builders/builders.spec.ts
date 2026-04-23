import { describe, expect, it } from "vitest";
import { VALID_API_TYPES, buildRequestBody } from "./index";

describe("buildRequestBody", () => {
  it("accepts every declared api type without throwing", () => {
    // Field names mirror what the legacy builders actually destructure from
    // the HTTP cfg object (embeddingInput, imagePrompt, rerankQuery, etc.).
    // The plan's template used generic names; the legacy source is authoritative.
    const minimalOpts = {
      model: "m",
      prompt: "hi",
      embeddingInput: "hi",
      rerankQuery: "q",
      rerankTexts: "a\nb",
      imagePrompt: "a cat",
      imageSize: "256x256",
      imageN: 1,
      imageUrl: "data:image/png;base64,AAAA",
      maxTokens: 8,
      temperature: 0.1,
    };
    for (const t of VALID_API_TYPES) {
      expect(() => buildRequestBody(t, minimalOpts)).not.toThrow();
    }
  });

  it("rejects an unknown apiType at the type level (runtime throw)", () => {
    expect(() => buildRequestBody("bogus" as never, {})).toThrow(/Unknown apiType/);
  });
});
