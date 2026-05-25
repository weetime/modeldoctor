import type { V1ContainerStatus, V1Pod } from "@kubernetes/client-node";

/** Name of the benchmark runner container in the Job manifest. SSOT — keep
 *  in sync with apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts. */
export const RUNNER_CONTAINER_NAME = "runner";

/** Find the runner container status by name. Returns undefined if the pod has
 *  no containerStatuses (e.g., still scheduling) or no matching container.
 *  Use this instead of containerStatuses[0]: sidecars may be added in the
 *  future and the index ordering is undefined. */
export function getRunnerStatus(pod: V1Pod): V1ContainerStatus | undefined {
  return pod.status?.containerStatuses?.find((c) => c.name === RUNNER_CONTAINER_NAME);
}
