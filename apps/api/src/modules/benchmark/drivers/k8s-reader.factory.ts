import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";
import type { BenchmarkK8sReader } from "../benchmark.reconciler.js";

async function loadK8sClient(): Promise<typeof import("@kubernetes/client-node")> {
  const stub = (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__;
  if (stub) return stub() as typeof import("@kubernetes/client-node");
  return await import("@kubernetes/client-node");
}

export async function createBenchmarkK8sReader(
  config: ConfigService<Env, true>,
): Promise<BenchmarkK8sReader | null> {
  const driver = (config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess") as string;
  if (driver !== "k8s") return null;
  const k8s = await loadK8sClient();
  const kc = new k8s.KubeConfig();
  // Mirror driver.factory.ts: prefer an explicit KUBECONFIG so out-of-cluster
  // dev doesn't fall through to ~/.kube/config and accidentally read a real
  // cluster's context. In-cluster mode (KUBECONFIG unset) is handled by
  // loadFromDefault()'s ServiceAccount fallback.
  const explicitKubeconfig = config.get("KUBECONFIG", { infer: true }) as string | undefined;
  if (explicitKubeconfig) {
    kc.loadFromFile(explicitKubeconfig);
  } else {
    kc.loadFromDefault();
  }
  const batch = kc.makeApiClient(k8s.BatchV1Api);
  const core = kc.makeApiClient(k8s.CoreV1Api);
  return {
    async readJob(name, namespace) {
      const res = await batch.readNamespacedJob(name, namespace);
      return (res as { body?: { status?: { failed?: number } } }).body ?? {};
    },
    async listJobPods(name, namespace) {
      const res = await core.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `job-name=${name}`,
      );
      const items = (res as { body?: { items?: unknown[] } }).body?.items ?? [];
      return items as Awaited<ReturnType<BenchmarkK8sReader["listJobPods"]>>;
    },
  };
}
