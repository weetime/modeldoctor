import { describe, expect, it } from "vitest";
import { DEFAULT_GEN_CONFIG, genConfigSchema, resolveGenConfig } from "../gen-config.js";

describe("genConfigSchema", () => {
  it("applies defaults", () => {
    expect(genConfigSchema.parse({})).toEqual({
      maxTokens: 2048,
      temperature: 0,
      thinking: "auto",
    });
  });
  it("rejects out-of-range temperature", () => {
    expect(() => genConfigSchema.parse({ temperature: 3 })).toThrow();
  });
  it("rejects maxTokens over cap", () => {
    expect(() => genConfigSchema.parse({ maxTokens: 99999 })).toThrow();
  });
  it("accepts thinking enum + stop", () => {
    expect(genConfigSchema.parse({ thinking: "off", stop: ["\n\n"] })).toMatchObject({
      thinking: "off",
      stop: ["\n\n"],
    });
  });
});

describe("resolveGenConfig (defaults < eval < run)", () => {
  it("returns DEFAULT when nothing provided", () => {
    expect(resolveGenConfig()).toEqual(DEFAULT_GEN_CONFIG);
  });
  it("eval default overrides schema default", () => {
    expect(resolveGenConfig({ thinking: "off" })).toMatchObject({
      thinking: "off",
      maxTokens: 2048,
    });
  });
  it("run override beats eval default", () => {
    expect(
      resolveGenConfig({ thinking: "off", maxTokens: 512 }, { maxTokens: 4096 }),
    ).toMatchObject({
      thinking: "off",
      maxTokens: 4096,
    });
  });
  it("null layers are ignored", () => {
    expect(resolveGenConfig(null, null)).toEqual(DEFAULT_GEN_CONFIG);
  });
});
