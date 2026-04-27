import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../config/env.schema.js";
import { createBenchmarkDriver } from "./driver.factory.js";
import { K8sJobDriver } from "./k8s-job-driver.js";
import { SubprocessDriver } from "./subprocess-driver.js";

function buildConfig(over: Record<string, unknown>): ConfigService<Env, true> {
  return {
    get: (key: string) => over[key],
  } as unknown as ConfigService<Env, true>;
}

describe("createBenchmarkDriver", () => {
  it("returns a SubprocessDriver when BENCHMARK_DRIVER=subprocess", async () => {
    const drv = await createBenchmarkDriver(buildConfig({ BENCHMARK_DRIVER: "subprocess" }));
    expect(drv).toBeInstanceOf(SubprocessDriver);
  });

  it("defaults to subprocess when BENCHMARK_DRIVER is unset", async () => {
    const drv = await createBenchmarkDriver(buildConfig({}));
    expect(drv).toBeInstanceOf(SubprocessDriver);
  });

  it("returns a K8sJobDriver when BENCHMARK_DRIVER=k8s", async () => {
    // Stub the dynamic @kubernetes/client-node import so the test doesn't need
    // a real kubeconfig.
    vi.stubGlobal("__test_kc_loader__", () => ({
      KubeConfig: class {
        loadFromDefault() {}
        loadFromFile(_path: string) {}
        makeApiClient() {
          return {};
        }
      },
      BatchV1Api: class {},
      CoreV1Api: class {},
    }));
    const drv = await createBenchmarkDriver(
      buildConfig({
        BENCHMARK_DRIVER: "k8s",
        BENCHMARK_K8S_NAMESPACE: "modeldoctor-benchmarks",
        BENCHMARK_RUNNER_IMAGE: "img:tag",
      }),
    );
    expect(drv).toBeInstanceOf(K8sJobDriver);
  });

  it("uses KUBECONFIG path via loadFromFile when set, otherwise loadFromDefault", async () => {
    // Track which loader was called per-instantiation.
    const calls: string[] = [];
    vi.stubGlobal("__test_kc_loader__", () => ({
      KubeConfig: class {
        loadFromDefault() {
          calls.push("default");
        }
        loadFromFile(path: string) {
          calls.push(`file:${path}`);
        }
        makeApiClient() {
          return {};
        }
      },
      BatchV1Api: class {},
      CoreV1Api: class {},
    }));

    await createBenchmarkDriver(
      buildConfig({
        BENCHMARK_DRIVER: "k8s",
        BENCHMARK_K8S_NAMESPACE: "ns",
        BENCHMARK_RUNNER_IMAGE: "img:tag",
        KUBECONFIG: "/custom/kubeconfig",
      }),
    );
    expect(calls).toEqual(["file:/custom/kubeconfig"]);

    calls.length = 0;
    await createBenchmarkDriver(
      buildConfig({
        BENCHMARK_DRIVER: "k8s",
        BENCHMARK_K8S_NAMESPACE: "ns",
        BENCHMARK_RUNNER_IMAGE: "img:tag",
      }),
    );
    expect(calls).toEqual(["default"]);
  });

  it("rejects unknown driver names", async () => {
    await expect(createBenchmarkDriver(buildConfig({ BENCHMARK_DRIVER: "bogus" }))).rejects.toThrow(
      /BENCHMARK_DRIVER/,
    );
  });

  it("requires BENCHMARK_RUNNER_IMAGE in k8s mode", async () => {
    await expect(
      createBenchmarkDriver(
        buildConfig({ BENCHMARK_DRIVER: "k8s", BENCHMARK_K8S_NAMESPACE: "ns" }),
      ),
    ).rejects.toThrow(/BENCHMARK_RUNNER_IMAGE/);
  });
});
