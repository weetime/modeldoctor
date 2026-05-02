import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";
import { createRunDriver, imageForTool } from "./run-driver.factory.js";
import { SubprocessDriver } from "./subprocess-driver.js";

function mockConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const defaults: Partial<Env> = {
    BENCHMARK_DRIVER: "subprocess",
    BENCHMARK_K8S_NAMESPACE: "modeldoctor-runs",
    RUNNER_IMAGE_GUIDELLM: "img-guidellm:latest",
    RUNNER_IMAGE_VEGETA: "img-vegeta:latest",
    RUNNER_IMAGE_GENAI_PERF: "img-genai-perf:latest",
    ...overrides,
  } as Partial<Env>;
  return {
    get: vi.fn((k: keyof Env) => defaults[k]),
  } as unknown as ConfigService<Env, true>;
}

describe("imageForTool", () => {
  it("returns the per-tool env var", () => {
    const cfg = mockConfig();
    expect(imageForTool("guidellm", cfg)).toBe("img-guidellm:latest");
    expect(imageForTool("vegeta", cfg)).toBe("img-vegeta:latest");
    expect(imageForTool("genai-perf", cfg)).toBe("img-genai-perf:latest");
  });

  it("throws when image env var is unset", () => {
    const cfg = mockConfig({ RUNNER_IMAGE_GUIDELLM: undefined });
    expect(() => imageForTool("guidellm", cfg)).toThrow(/RUNNER_IMAGE_GUIDELLM/);
  });
});

describe("createRunDriver", () => {
  it("builds a SubprocessDriver when BENCHMARK_DRIVER=subprocess", async () => {
    const cfg = mockConfig({ BENCHMARK_DRIVER: "subprocess" });
    const d = await createRunDriver(cfg);
    expect(d).toBeInstanceOf(SubprocessDriver);
  });
});
