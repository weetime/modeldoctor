import { beforeEach, describe, expect, it } from "vitest";
import { useRerankStore } from "./store";

describe("useRerankStore", () => {
  beforeEach(() => useRerankStore.getState().reset());

  it("starts with empty query, single empty doc, wire=cohere, topN=3", () => {
    expect(useRerankStore.getState().query).toBe("");
    expect(useRerankStore.getState().documents).toEqual([""]);
    expect(useRerankStore.getState().params.wire).toBe("cohere");
    expect(useRerankStore.getState().params.topN).toBe(3);
  });

  it("addDocument / removeDocument / setDocAt work", () => {
    useRerankStore.getState().addDocument();
    useRerankStore.getState().setDocAt(0, "a");
    useRerankStore.getState().setDocAt(1, "b");
    useRerankStore.getState().removeDocument(0);
    expect(useRerankStore.getState().documents).toEqual(["b"]);
  });

  it("clearDocuments resets to a single empty doc", () => {
    useRerankStore.getState().setDocAt(0, "a");
    useRerankStore.getState().addDocument();
    useRerankStore.getState().setDocAt(1, "b");
    useRerankStore.getState().clearDocuments();
    expect(useRerankStore.getState().documents).toEqual([""]);
  });

  it("setBatchText splits on newline", () => {
    useRerankStore.getState().setBatchText("a\nb\n\nc");
    expect(useRerankStore.getState().documents).toEqual(["a", "b", "c"]);
  });

  it("setResults stores [{index,score}] sorted by descending score", () => {
    useRerankStore.getState().setResults([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
    expect(useRerankStore.getState().results).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
  });
});
