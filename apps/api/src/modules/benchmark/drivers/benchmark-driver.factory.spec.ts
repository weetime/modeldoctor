import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../config/env.schema.js";
import { createBenchmarkDriver, imageForTool } from "./benchmark-driver.factory.js";

function mockConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const defaults: Partial<Env> = {
    BENCHMARK_K8S_NAMESPACE: "modeldoctor-benchmarks",
    RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:test",
    RUNNER_IMAGE_VEGETA: "md-runner-vegeta:test",
    RUNNER_IMAGE_GENAI_PERF: "md-runner-genai-perf:test",
    ...overrides,
  } as Partial<Env>;
  return {
    get: vi.fn((k: keyof Env) => defaults[k]),
  } as unknown as ConfigService<Env, true>;
}

describe("imageForTool", () => {
  it("returns the per-tool env var", () => {
    const cfg = mockConfig();
    expect(imageForTool("guidellm", cfg)).toBe("md-runner-guidellm:test");
    expect(imageForTool("vegeta", cfg)).toBe("md-runner-vegeta:test");
    expect(imageForTool("genai-perf", cfg)).toBe("md-runner-genai-perf:test");
  });

  it("throws when image env var is unset", () => {
    const cfg = mockConfig({ RUNNER_IMAGE_GUIDELLM: undefined });
    expect(() => imageForTool("guidellm", cfg)).toThrow(/RUNNER_IMAGE_GUIDELLM/);
  });
});

describe("createBenchmarkDriver", () => {
  it("builds a K8sJobDriver (via __test_kc_loader__)", async () => {
    const cfg = mockConfig({ BENCHMARK_K8S_NAMESPACE: "ns-x" });
    // Stub the lazy k8s import so the test doesn't pull in the real client.
    const fakeK8s = {
      KubeConfig: class {
        loadFromFile = vi.fn();
        loadFromDefault = vi.fn();
        makeApiClient = vi.fn(() => ({}) as never);
      },
      BatchV1Api: class {},
      CoreV1Api: class {},
    };
    (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__ = () => fakeK8s;
    try {
      const d = await createBenchmarkDriver(cfg);
      const { K8sJobDriver } = await import("./k8s-job-driver.js");
      expect(d).toBeInstanceOf(K8sJobDriver);
    } finally {
      (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__ = undefined;
    }
  });
});
