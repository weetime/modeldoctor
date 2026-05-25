import type { V1Pod } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import {
  podFailed,
  podPending,
  podPendingWaiting,
  podRunning,
  podSucceeded,
} from "./__fixtures__/pod-fixtures.js";
import { DEFAULT_FATAL_WAITING_REASONS, type ReducerConfig, reduce } from "./pod-state-reducer.js";

const CONFIG: ReducerConfig = {
  fatalWaitingReasons: DEFAULT_FATAL_WAITING_REASONS,
  waitingFatalGraceSec: 60,
  terminalReconcileGraceSec: 60,
};

const NOW = new Date("2026-05-25T10:00:00Z");

describe("PodStateReducer", () => {
  describe("noop cases", () => {
    it("returns noop when benchmark already terminal", () => {
      const r = reduce({
        pod: podSucceeded(),
        currentStatus: "completed",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });

    it("returns noop on plain Pending (no waiting reason yet)", () => {
      const r = reduce({
        pod: podPending(),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });

    it("returns noop on Running (backstop does not flip to running)", () => {
      const r = reduce({
        pod: podRunning(),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });

    it("returns noop on transient ContainerCreating waiting", () => {
      const r = reduce({
        pod: podPendingWaiting("ContainerCreating"),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });
  });

  describe("FATAL waiting → failed-pre-start", () => {
    for (const reason of DEFAULT_FATAL_WAITING_REASONS) {
      it(`flags ${reason} after grace`, () => {
        const firstSeen = new Date(NOW.getTime() - 61_000);
        const r = reduce({
          pod: podPendingWaiting(reason, "details here"),
          currentStatus: "submitted",
          firstFatalWaitingAt: firstSeen,
          firstTerminalAt: null,
          now: NOW,
          config: CONFIG,
          mode: "backstop",
        });
        expect(r.kind).toBe("failed-pre-start");
        if (r.kind === "failed-pre-start") {
          expect(r.reason).toBe(reason);
          expect(r.message).toContain("details here");
        }
      });
    }

    it("does NOT flag within grace window", () => {
      const firstSeen = new Date(NOW.getTime() - 30_000);
      const r = reduce({
        pod: podPendingWaiting("ImagePullBackOff"),
        currentStatus: "submitted",
        firstFatalWaitingAt: firstSeen,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });

    it("does NOT flag when firstFatalWaitingAt is null (just saw it)", () => {
      const r = reduce({
        pod: podPendingWaiting("ImagePullBackOff"),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });
  });

  describe("terminal phase + IN_PROGRESS → failed-terminal (after grace)", () => {
    it("Failed pod after grace → failed-terminal with exitCode/reason/message", () => {
      const firstTerm = new Date(NOW.getTime() - 61_000);
      const r = reduce({
        pod: podFailed(137, "OOMKilled", "Memory limit exceeded"),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("failed-terminal");
      if (r.kind === "failed-terminal") {
        expect(r.exitCode).toBe(137);
        expect(r.reason).toBe("OOMKilled");
        expect(r.message).toContain("Memory limit exceeded");
      }
    });

    it("Succeeded pod after grace + IN_PROGRESS → failed-terminal (silent runner)", () => {
      const firstTerm = new Date(NOW.getTime() - 61_000);
      const r = reduce({
        pod: podSucceeded(),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("failed-terminal");
      if (r.kind === "failed-terminal") {
        expect(r.exitCode).toBe(0);
        expect(r.message).toMatch(/callback never arrived|no callback/i);
      }
    });

    it("Failed pod within grace window → noop (give callback a chance)", () => {
      const firstTerm = new Date(NOW.getTime() - 30_000);
      const r = reduce({
        pod: podFailed(),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });

    it("Terminal pod + benchmark already terminal → noop", () => {
      const firstTerm = new Date(NOW.getTime() - 999_000);
      const r = reduce({
        pod: podSucceeded(),
        currentStatus: "completed",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("noop");
    });
  });

  describe("statusMessage construction", () => {
    it("truncates long messages to 2048 chars", () => {
      const longMsg = "x".repeat(5000);
      const firstTerm = new Date(NOW.getTime() - 61_000);
      const r = reduce({
        pod: podFailed(1, "Error", longMsg),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
        mode: "backstop",
      });
      expect(r.kind).toBe("failed-terminal");
      if (r.kind === "failed-terminal") {
        expect(r.message.length).toBeLessThanOrEqual(2048);
        // Prefix must survive truncation — losing "Error: " would erase reason context.
        expect(r.message.startsWith("Error: ")).toBe(true);
      }
    });
  });
});

describe("PodStateReducer — primary mode", () => {
  const baseConfig: ReducerConfig = {
    fatalWaitingReasons: ["ImagePullBackOff", "CrashLoopBackOff"],
    waitingFatalGraceSec: 60,
    terminalReconcileGraceSec: 60,
  };
  const now = new Date("2026-05-25T01:00:00Z");

  function makePod(status: Partial<NonNullable<V1Pod["status"]>>): V1Pod {
    return {
      metadata: { labels: { "modeldoctor.ai/run-id": "r1" } },
      status: { phase: "Pending", ...status },
    } as V1Pod;
  }

  it("Succeeded + IN_PROGRESS → load-report", () => {
    const out = reduce({
      pod: makePod({ phase: "Succeeded" }),
      currentStatus: "running",
      firstFatalWaitingAt: null,
      firstTerminalAt: null,
      now,
      config: baseConfig,
      mode: "primary",
    });
    expect(out).toEqual({ kind: "load-report" });
  });

  it("Failed + IN_PROGRESS → failed-terminal (no grace)", () => {
    const out = reduce({
      pod: makePod({
        phase: "Failed",
        containerStatuses: [
          {
            name: "runner",
            ready: false,
            image: "x",
            imageID: "x",
            restartCount: 0,
            state: { terminated: { exitCode: 1, reason: "Error", message: "boom" } },
          },
        ],
      }),
      currentStatus: "running",
      firstFatalWaitingAt: null,
      firstTerminalAt: null,
      now,
      config: baseConfig,
      mode: "primary",
    });
    expect(out).toMatchObject({ kind: "failed-terminal", exitCode: 1, reason: "Error" });
  });

  it("Running + container ready + status=submitted → running", () => {
    const startedAt = "2026-05-25T00:50:00Z";
    const out = reduce({
      pod: makePod({
        phase: "Running",
        containerStatuses: [
          {
            name: "runner",
            ready: true,
            image: "x",
            imageID: "x",
            restartCount: 0,
            state: { running: { startedAt: new Date(startedAt) } },
          },
        ],
      }),
      currentStatus: "submitted",
      firstFatalWaitingAt: null,
      firstTerminalAt: null,
      now,
      config: baseConfig,
      mode: "primary",
    });
    expect(out).toEqual({ kind: "running", startedAt: new Date(startedAt) });
  });

  it("Running + container NOT ready → noop", () => {
    const out = reduce({
      pod: makePod({
        phase: "Running",
        containerStatuses: [
          {
            name: "runner",
            ready: false,
            image: "x",
            imageID: "x",
            restartCount: 0,
            state: { running: { startedAt: new Date(now) } },
          },
        ],
      }),
      currentStatus: "submitted",
      firstFatalWaitingAt: null,
      firstTerminalAt: null,
      now,
      config: baseConfig,
      mode: "primary",
    });
    expect(out).toEqual({ kind: "noop" });
  });

  it("Pending + ImagePullBackOff + grace not elapsed → noop", () => {
    const out = reduce({
      pod: makePod({
        phase: "Pending",
        containerStatuses: [
          {
            name: "runner",
            ready: false,
            image: "x",
            imageID: "x",
            restartCount: 0,
            state: { waiting: { reason: "ImagePullBackOff", message: "no such image" } },
          },
        ],
      }),
      currentStatus: "submitted",
      firstFatalWaitingAt: new Date(now.getTime() - 30_000),
      firstTerminalAt: null,
      now,
      config: baseConfig,
      mode: "primary",
    });
    expect(out).toEqual({ kind: "noop" });
  });

  it("Pending + ImagePullBackOff + grace elapsed → failed-pre-start", () => {
    const out = reduce({
      pod: makePod({
        phase: "Pending",
        containerStatuses: [
          {
            name: "runner",
            ready: false,
            image: "x",
            imageID: "x",
            restartCount: 0,
            state: { waiting: { reason: "ImagePullBackOff", message: "no such image" } },
          },
        ],
      }),
      currentStatus: "submitted",
      firstFatalWaitingAt: new Date(now.getTime() - 70_000),
      firstTerminalAt: null,
      now,
      config: baseConfig,
      mode: "primary",
    });
    expect(out).toMatchObject({ kind: "failed-pre-start", reason: "ImagePullBackOff" });
  });

  it("any phase + terminal benchmark status → noop", () => {
    const out = reduce({
      pod: makePod({ phase: "Succeeded" }),
      currentStatus: "completed",
      firstFatalWaitingAt: null,
      firstTerminalAt: null,
      now,
      config: baseConfig,
      mode: "primary",
    });
    expect(out).toEqual({ kind: "noop" });
  });
});
