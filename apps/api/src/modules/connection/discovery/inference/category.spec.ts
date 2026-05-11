import type { InferenceConfidence } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { inferCategory } from "./category.js";

describe("inferCategory", () => {
  const cases: Array<[string, string | null, InferenceConfidence]> = [
    ["bge-reranker-v2-m3", "rerank", "likely"],
    ["my-rerank-model", "rerank", "likely"],
    ["bge-large-en", "embeddings", "likely"],
    ["text-embedding-3-small", "embeddings", "likely"],
    ["e5-mistral-7b", "embeddings", "likely"],
    ["gte-large", "embeddings", "likely"],
    ["m3e-base", "embeddings", "likely"],
    ["flux-dev", "image", "likely"],
    ["sd-xl-base", "image", "likely"],
    ["stable-diffusion-3", "image", "likely"],
    ["dall-e-3", "image", "likely"],
    ["imagen-2", "image", "likely"],
    ["whisper-large-v3", "audio", "likely"],
    ["voxtral-small", "audio", "likely"],
    ["my-tts-model", "audio", "likely"],
    ["parakeet-en", "audio", "likely"],
    ["gpt-4o-mini", "chat", "guess"],
    ["llama-3-70b-instruct", "chat", "guess"],
    ["qwen2.5-7b", "chat", "guess"],
    ["claude-haiku", "chat", "guess"],
  ];

  it.each(cases)("infers category for '%s'", (modelId, expectedCategory, expectedConf) => {
    const r = inferCategory({ models: [modelId] });
    expect(r.value).toBe(expectedCategory);
    expect(r.confidence).toBe(expectedConf);
  });

  it("uses first model when multiple are present", () => {
    const r = inferCategory({ models: ["bge-large-en", "gpt-4o"] });
    expect(r.value).toBe("embeddings");
  });

  it("returns unknown when no models", () => {
    const r = inferCategory({ models: [] });
    expect(r.value).toBeNull();
    expect(r.confidence).toBe<InferenceConfidence>("unknown");
  });
});
