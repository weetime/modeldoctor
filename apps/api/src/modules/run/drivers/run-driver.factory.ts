import type { ConfigService } from "@nestjs/config";
import type { ToolName } from "@modeldoctor/tool-adapters";
import type { Env } from "../../../config/env.schema.js";
import type { RunExecutionDriver } from "./execution-driver.interface.js";
import { K8sJobDriver } from "./k8s-job-driver.js";
import { SubprocessDriver } from "./subprocess-driver.js";

const TOOL_TO_IMAGE_ENV: Record<ToolName, keyof Env> = {
  guidellm: "RUNNER_IMAGE_GUIDELLM",
  "genai-perf": "RUNNER_IMAGE_GENAI_PERF",
  vegeta: "RUNNER_IMAGE_VEGETA",
};

export function imageForTool(tool: ToolName, config: ConfigService<Env, true>): string {
  const key = TOOL_TO_IMAGE_ENV[tool];
  const v = config.get(key, { infer: true }) as string | undefined;
  if (!v) {
    throw new Error(
      `Missing image config for tool '${tool}': set the ${String(key)} environment variable.`,
    );
  }
  return v;
}

async function loadK8sClient(): Promise<typeof import("@kubernetes/client-node")> {
  const stub = (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__;
  if (stub) return stub() as typeof import("@kubernetes/client-node");
  return await import("@kubernetes/client-node");
}

export async function createRunDriver(
  config: ConfigService<Env, true>,
): Promise<RunExecutionDriver> {
  const choice = (config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess") as string;
  if (choice === "subprocess") {
    return new SubprocessDriver();
  }
  if (choice === "k8s") {
    const ns = (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) ??
      "modeldoctor-runs") as string;
    const k8s = await loadK8sClient();
    const kc = new k8s.KubeConfig();
    const explicitKubeconfig = config.get("KUBECONFIG", { infer: true }) as string | undefined;
    if (explicitKubeconfig) {
      kc.loadFromFile(explicitKubeconfig);
    } else {
      kc.loadFromDefault();
    }
    return new K8sJobDriver({
      namespace: ns,
      apis: {
        batch: kc.makeApiClient(k8s.BatchV1Api),
        core: kc.makeApiClient(k8s.CoreV1Api),
      },
    });
  }
  throw new Error(`Unknown BENCHMARK_DRIVER value: ${choice}`);
}
