import { describe, expect, it } from "vitest";
import { ENGINE_CAPABILITY, ENGINE_DISPLAY_NAME, ENGINE_IDS, type EngineId } from "./engine.js";

describe("engine SSOT", () => {
  it("declares all 11 engines exactly once", () => {
    expect(new Set(ENGINE_IDS).size).toBe(ENGINE_IDS.length);
    expect(ENGINE_IDS).toHaveLength(11);
  });

  it("has display name for every engine id", () => {
    for (const id of ENGINE_IDS) {
      expect(ENGINE_DISPLAY_NAME[id]).toBeTruthy();
    }
  });

  it("has capability for every engine id", () => {
    for (const id of ENGINE_IDS) {
      expect(["generative", "embedding"]).toContain(ENGINE_CAPABILITY[id]);
    }
  });

  it("classifies tei + infinity as embedding", () => {
    const embedding: EngineId[] = ENGINE_IDS.filter((id) => ENGINE_CAPABILITY[id] === "embedding");
    expect(new Set(embedding)).toEqual(new Set(["tei", "infinity"]));
  });
});
