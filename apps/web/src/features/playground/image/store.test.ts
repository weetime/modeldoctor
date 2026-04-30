import { beforeEach, describe, expect, it } from "vitest";
import { useImageStore } from "./store";

describe("useImageStore", () => {
  beforeEach(() => useImageStore.getState().reset());

  it("starts with default size 512x512 and n=1", () => {
    expect(useImageStore.getState().params.size).toBe("512x512");
    expect(useImageStore.getState().params.n).toBe(1);
  });

  it("setPrompt + patchParams update state", () => {
    useImageStore.getState().setPrompt("a red apple");
    useImageStore.getState().patchParams({ seed: 7 });
    expect(useImageStore.getState().prompt).toBe("a red apple");
    expect(useImageStore.getState().params.seed).toBe(7);
  });

  it("setResults populates artifacts", () => {
    useImageStore.getState().setResults([{ url: "http://i/0", b64Json: undefined }]);
    expect(useImageStore.getState().results).toHaveLength(1);
  });

  it("inpaint state has sensible defaults", () => {
    const s = useImageStore.getState();
    expect(s.inpaint.brushSize).toBe(30);
    expect(s.inpaint.prompt).toBe("");
    expect(s.inpaint.imageName).toBeNull();
    expect(s.inpaint.results).toEqual([]);
  });

  it("patchInpaint merges into the inpaint slice; resetInpaint clears it", () => {
    const s = useImageStore.getState();
    s.patchInpaint({ prompt: "blue eyes", brushSize: 50 });
    expect(useImageStore.getState().inpaint.prompt).toBe("blue eyes");
    expect(useImageStore.getState().inpaint.brushSize).toBe(50);
    s.resetInpaint();
    expect(useImageStore.getState().inpaint.prompt).toBe("");
    expect(useImageStore.getState().inpaint.brushSize).toBe(30);
  });
});
