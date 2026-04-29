import { beforeEach, describe, expect, it } from "vitest";
import { useEmbeddingsStore } from "./store";

describe("useEmbeddingsStore", () => {
  beforeEach(() => useEmbeddingsStore.getState().reset());

  it("starts with one empty input row and batchMode off", () => {
    const s = useEmbeddingsStore.getState();
    expect(s.inputs).toEqual([""]);
    expect(s.batchMode).toBe(false);
  });

  it("addInput and removeInput maintain the inputs array", () => {
    useEmbeddingsStore.getState().addInput();
    expect(useEmbeddingsStore.getState().inputs).toHaveLength(2);
    useEmbeddingsStore.getState().setInputAt(0, "hello");
    useEmbeddingsStore.getState().setInputAt(1, "world");
    useEmbeddingsStore.getState().removeInput(0);
    expect(useEmbeddingsStore.getState().inputs).toEqual(["world"]);
  });

  it("setBatchText splits on \\n into inputs[]", () => {
    useEmbeddingsStore.getState().setBatchText("a\n b \n\nc");
    expect(useEmbeddingsStore.getState().inputs).toEqual(["a", "b", "c"]);
  });

  it("setResult populates the embeddings array", () => {
    useEmbeddingsStore.getState().setResult([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(useEmbeddingsStore.getState().result).toHaveLength(2);
  });
});
