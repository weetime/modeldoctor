import { describe, expect, it } from "vitest";
import { ENGINE_IDS } from "../../../engine.js";
import { ENGINE_MANIFEST_IDS, getEngineManifest } from "../index.js";

describe("engine manifest registry", () => {
  it("exports all 5 M1 manifests", () => {
    expect(ENGINE_MANIFEST_IDS.sort()).toEqual(
      ["vllm", "sglang", "tgi", "mindie", "tei"].sort(),
    );
  });

  it("getEngineManifest returns the manifest for known ids", () => {
    for (const id of ENGINE_MANIFEST_IDS) {
      const m = getEngineManifest(id);
      expect(m).toBeDefined();
      expect(m?.engineId).toBe(id);
    }
  });

  it("getEngineManifest returns null for unsupported engines", () => {
    const unsupported = ENGINE_IDS.filter(
      (id) => !ENGINE_MANIFEST_IDS.includes(id as never),
    );
    for (const id of unsupported) {
      expect(getEngineManifest(id)).toBeNull();
    }
  });
});
