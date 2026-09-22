import { describe, expect, it } from "vitest";
import {
  resolveDedicatedRoute,
  tokenizerFromSource,
  toModalityCategory,
  toProbes,
  toServerKind,
} from "./mapping.js";

describe("toModalityCategory", () => {
  it.each([
    [["llm"], "chat"],
    [["embedding"], "embeddings"],
    [["reranker"], "rerank"],
    [["image"], "image"],
    [["speech_to_text"], "audio"],
    [["text_to_speech"], "audio"],
    [[], "chat"],
    [["unknown"], "chat"],
  ])("%j -> %s", (cats, expected) => {
    expect(toModalityCategory(cats)).toBe(expected);
  });
});

describe("toServerKind", () => {
  it("lowercases known engines", () => {
    expect(toServerKind("vLLM")).toBe("vllm");
    expect(toServerKind("SGLang")).toBe("sglang");
    expect(toServerKind("MindIE")).toBe("mindie");
  });
  it("falls back to generic", () => {
    expect(toServerKind("vox-box")).toBe("generic");
    expect(toServerKind(null)).toBe("generic");
  });
});

describe("toProbes", () => {
  it.each([
    [["llm"], ["chat-text"]],
    [["embedding"], ["embeddings-openai"]],
    [["reranker"], ["rerank-cohere"]],
    [["image"], ["image-gen"]],
    [["text_to_speech"], ["tts"]],
    [["speech_to_text"], ["asr"]],
    [[], ["chat-text"]],
  ])("%j -> %j", (cats, expected) => {
    expect(toProbes(cats)).toEqual(expected);
  });
});

describe("resolveDedicatedRoute", () => {
  const routes = [
    { id: 1, name: "shared", created_model_id: 7, targets: 2 },
    { id: 2, name: "qwen", effective_name: "org/qwen", created_model_id: 7, targets: 1 },
    { id: 3, name: "other", created_model_id: 8, targets: 1 },
  ];
  it("prefers effective_name of single-target route created for the model", () => {
    expect(resolveDedicatedRoute(7, routes)).toBe("org/qwen");
  });
  it("falls back to name when effective_name missing", () => {
    expect(resolveDedicatedRoute(8, routes)).toBe("other");
  });
  it("returns null when no dedicated route", () => {
    expect(resolveDedicatedRoute(9, routes)).toBeNull();
  });
});

describe("tokenizerFromSource", () => {
  it("uses huggingface repo id", () => {
    expect(
      tokenizerFromSource({
        id: 1,
        name: "x",
        source: "huggingface",
        huggingface_repo_id: "Qwen/Qwen3-8B",
      }),
    ).toBe("Qwen/Qwen3-8B");
  });
  it("uses modelscope id", () => {
    expect(
      tokenizerFromSource({
        id: 1,
        name: "x",
        source: "model_scope",
        model_scope_model_id: "Qwen/Qwen3-8B",
      }),
    ).toBe("Qwen/Qwen3-8B");
  });
  it("null for local path", () => {
    expect(
      tokenizerFromSource({ id: 1, name: "x", source: "local_path", local_path: "/m" }),
    ).toBeNull();
  });
});
