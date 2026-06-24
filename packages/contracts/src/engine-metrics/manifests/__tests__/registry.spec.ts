import { describe, expect, it } from "vitest";
import { ENGINE_IDS } from "../../../engine.js";
import { ENGINE_MANIFEST_IDS, getEngineManifest } from "../index.js";
import { inferManifest } from "../infer.js";

describe("engine manifest registry", () => {
  it("lists the supported engines (drives connection-discovery + the enum)", () => {
    expect(ENGINE_MANIFEST_IDS.slice().sort()).toEqual(
      ["vllm", "sglang", "tgi", "mindie", "tei"].slice().sort(),
    );
  });

  it("every supported engine resolves to the shared normalized inferManifest", () => {
    // Normalization moved to the Prometheus recording-rule layer (infer:*), so
    // there is no longer a per-engine manifest — all engines share one.
    for (const id of ENGINE_MANIFEST_IDS) {
      expect(getEngineManifest(id)).toBe(inferManifest);
    }
  });

  it("getEngineManifest returns null for unsupported engines", () => {
    const unsupported = ENGINE_IDS.filter((id) => !ENGINE_MANIFEST_IDS.includes(id as never));
    for (const id of unsupported) {
      expect(getEngineManifest(id)).toBeNull();
    }
  });
});
