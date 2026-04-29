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
});
