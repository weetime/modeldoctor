import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";
import type { BenchmarkExecutionDriver } from "./execution-driver.interface.js";
import { K8sJobDriver } from "./k8s-job-driver.js";
import { SubprocessDriver } from "./subprocess-driver.js";

/**
 * Loads @kubernetes/client-node lazily so subprocess-only sessions don't
 * pay the ~30MB module load. A globalThis hook is exposed for tests to stub.
 */
async function loadK8sClient(): Promise<typeof import("@kubernetes/client-node")> {
  const stub = (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__;
  if (stub) return stub() as typeof import("@kubernetes/client-node");
  return await import("@kubernetes/client-node");
}

export async function createBenchmarkDriver(
  config: ConfigService<Env, true>,
): Promise<BenchmarkExecutionDriver> {
  const choice = (config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess") as string;
  if (choice === "subprocess") {
    return new SubprocessDriver();
  }
  if (choice === "k8s") {
    const ns = (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) ??
      "modeldoctor-benchmarks") as string;
    const image = config.get("BENCHMARK_RUNNER_IMAGE", { infer: true }) as string | undefined;
    if (!image) {
      throw new Error("BENCHMARK_DRIVER=k8s requires BENCHMARK_RUNNER_IMAGE to be set.");
    }
    const k8s = await loadK8sClient();
    const kc = new k8s.KubeConfig();
    // Prefer an explicit KUBECONFIG from .env / process.env over loadFromDefault().
    // @nestjs/config does not always populate process.env, so loadFromDefault()
    // would silently fall through to ~/.kube/config — easy to mis-target a real
    // cluster from local dev. ConfigService sees the validated .env value
    // either way. In-cluster mode leaves KUBECONFIG unset and loadFromDefault()
    // detects the ServiceAccount mount automatically.
    const explicitKubeconfig = config.get("KUBECONFIG", { infer: true }) as string | undefined;
    if (explicitKubeconfig) {
      kc.loadFromFile(explicitKubeconfig);
    } else {
      kc.loadFromDefault();
    }
    return new K8sJobDriver({
      namespace: ns,
      image,
      apis: {
        batch: kc.makeApiClient(k8s.BatchV1Api),
        core: kc.makeApiClient(k8s.CoreV1Api),
      },
    });
  }
  throw new Error(`Unknown BENCHMARK_DRIVER value: ${choice}`);
}
