import { describe, expect, it } from "vitest";
import {
  GENAI_PERF_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
} from "./category-defaults.js";

describe("VEGETA_CATEGORY_DEFAULTS", () => {
  it("maps every ModalityCategory to a supported apiType", () => {
    expect(VEGETA_CATEGORY_DEFAULTS.chat).toEqual({ apiType: "chat" });
    expect(VEGETA_CATEGORY_DEFAULTS.audio).toEqual({ apiType: "chat-audio" });
    expect(VEGETA_CATEGORY_DEFAULTS.embeddings).toEqual({ apiType: "embeddings" });
    expect(VEGETA_CATEGORY_DEFAULTS.rerank).toEqual({ apiType: "rerank" });
    expect(VEGETA_CATEGORY_DEFAULTS.image).toEqual({ apiType: "images" });
  });
});

describe("GENAI_PERF_CATEGORY_DEFAULTS", () => {
  it("maps chat / embeddings / rerank to endpointType, audio + image unsupported", () => {
    expect(GENAI_PERF_CATEGORY_DEFAULTS.chat).toEqual({ endpointType: "chat" });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.embeddings).toEqual({ endpointType: "embeddings" });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.rerank).toEqual({ endpointType: "rankings" });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.audio).toEqual({ unsupported: true });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.image).toEqual({ unsupported: true });
  });
});

describe("GUIDELLM_CATEGORY_DEFAULTS", () => {
  it("maps chat to apiType=chat, all other categories unsupported", () => {
    expect(GUIDELLM_CATEGORY_DEFAULTS.chat).toEqual({ apiType: "chat" });
    for (const c of ["audio", "embeddings", "rerank", "image"] as const) {
      expect(GUIDELLM_CATEGORY_DEFAULTS[c]).toEqual({ unsupported: true });
    }
  });
});
