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

describe("createRunDriver k8s branch", () => {
  it("builds a K8sJobDriver when BENCHMARK_DRIVER=k8s (via __test_kc_loader__)", async () => {
    const cfg = mockConfig({ BENCHMARK_DRIVER: "k8s", BENCHMARK_K8S_NAMESPACE: "ns-x" });
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
      const d = await createRunDriver(cfg);
      const { K8sJobDriver } = await import("./k8s-job-driver.js");
      expect(d).toBeInstanceOf(K8sJobDriver);
    } finally {
      delete (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__;
    }
  });

  it("throws on unknown BENCHMARK_DRIVER value", async () => {
    const cfg = mockConfig({ BENCHMARK_DRIVER: "wat" as never });
    await expect(createRunDriver(cfg)).rejects.toThrow(/Unknown BENCHMARK_DRIVER/);
  });
});
