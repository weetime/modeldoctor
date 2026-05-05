import { describe, expect, it } from "vitest";
import { BenchmarkModule } from "./benchmark.module.js";

describe("BenchmarkModule", () => {
  it("assertScenariosInvariant passes at boot", () => {
    const mod = new BenchmarkModule();
    expect(() => mod.onModuleInit()).not.toThrow();
  });
});
