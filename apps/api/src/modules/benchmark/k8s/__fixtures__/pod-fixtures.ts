import type { V1Pod } from "@kubernetes/client-node";

const FIXED_TIME = new Date("2026-05-25T09:00:00Z");

const RUN_ID = "run-abc";

const BASE: V1Pod = {
  metadata: {
    name: `run-${RUN_ID}-xyz`,
    namespace: "modeldoctor-benchmarks",
    labels: {
      "app.kubernetes.io/name": "modeldoctor-run",
      "app.kubernetes.io/managed-by": "modeldoctor-api",
      "modeldoctor.ai/run-id": RUN_ID,
    },
  },
  spec: { containers: [{ name: "runner", image: "x:latest" }] },
  status: {},
};

export function podRunId(): string {
  return RUN_ID;
}

export function podPending(): V1Pod {
  return {
    ...BASE,
    status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "True" }] },
  };
}

export function podPendingWaiting(reason: string, message = "test"): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Pending",
      containerStatuses: [
        {
          name: "runner",
          ready: false,
          restartCount: 0,
          image: "x:latest",
          imageID: "",
          state: { waiting: { reason, message } },
        },
      ],
    },
  };
}

export function podRunning(): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "runner",
          ready: true,
          restartCount: 0,
          image: "x:latest",
          imageID: "x@sha256:abc",
          state: { running: { startedAt: FIXED_TIME } },
        },
      ],
    },
  };
}

export function podSucceeded(): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Succeeded",
      containerStatuses: [
        {
          name: "runner",
          ready: false,
          restartCount: 0,
          image: "x:latest",
          imageID: "x@sha256:abc",
          state: { terminated: { exitCode: 0, reason: "Completed", finishedAt: FIXED_TIME } },
        },
      ],
    },
  };
}

export function podFailed(exitCode = 1, reason = "Error", message = "tool exit 1"): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Failed",
      containerStatuses: [
        {
          name: "runner",
          ready: false,
          restartCount: 0,
          image: "x:latest",
          imageID: "x@sha256:abc",
          state: { terminated: { exitCode, reason, message, finishedAt: FIXED_TIME } },
        },
      ],
    },
  };
}

export function podNoLabels(): V1Pod {
  return {
    metadata: { name: "rogue", namespace: "modeldoctor-benchmarks", labels: {} },
    spec: { containers: [{ name: "x", image: "x" }] },
    status: { phase: "Running" },
  };
}
