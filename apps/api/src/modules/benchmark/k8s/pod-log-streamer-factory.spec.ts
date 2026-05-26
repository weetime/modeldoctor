import { describe, expect, it, vi } from "vitest";
import { PodLogStreamerFactory } from "./pod-log-streamer-factory.js";
import { ProgressThrottle } from "./progress-throttle.js";

vi.mock("@modeldoctor/tool-adapters", () => ({
  byTool: vi.fn((tool: string) => ({
    parseProgress: (line: string) => {
      if (line.startsWith("PROGRESS:")) {
        return { kind: "progress", pct: Number.parseFloat(line.slice(9)) };
      }
      if (line === "THROW") throw new Error("adapter boom");
      return null;
    },
    name: tool,
  })),
}));

function makeFactory() {
  const repo = { update: vi.fn(async () => undefined), findById: vi.fn() };
  const sse = { publish: vi.fn() };
  const k8sLog = { log: vi.fn() };
  const factory = new PodLogStreamerFactory(repo as never, sse as never, k8sLog as never, "ns");
  return { factory, repo, sse, k8sLog };
}

describe("PodLogStreamerFactory", () => {
  it("create() returns a streamer wired to the right adapter + SSE + throttle", async () => {
    const { factory, repo, sse } = makeFactory();
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => 1_000);
    const streamer = factory.create("r1", "pod-r1", "guidellm", throttle);
    expect(streamer).toBeDefined();

    // Reach into the closure via injected handleLine; easier path:
    // ask factory to expose a build-handler helper for tests OR test via streamer run().
    // We test the wiring through factory.buildHandleLine (exposed for tests).
    const handle = factory.buildHandleLine("r1", "guidellm", throttle);
    handle("PROGRESS:0.5");
    expect(sse.publish).toHaveBeenCalledWith("r1", { kind: "progress", pct: 0.5 });
    // 1Hz throttle: first tick fires immediately
    await new Promise((r) => setImmediate(r));
    expect(repo.update).toHaveBeenCalledWith("r1", { progress: 0.5 });
  });

  it("buildHandleLine ignores parseProgress returning null", () => {
    const { factory, sse, repo } = makeFactory();
    const throttle = new ProgressThrottle("r1", repo as never, 1000);
    const handle = factory.buildHandleLine("r1", "guidellm", throttle);
    handle("not a progress line");
    expect(sse.publish).not.toHaveBeenCalled();
  });

  it("buildHandleLine wraps parseProgress throw in fallback log event", () => {
    const { factory, sse, repo } = makeFactory();
    const throttle = new ProgressThrottle("r1", repo as never, 1000);
    const handle = factory.buildHandleLine("r1", "guidellm", throttle);
    handle("THROW");
    expect(sse.publish).toHaveBeenCalledWith("r1", {
      kind: "log",
      level: "warn",
      line: "THROW",
    });
  });

  it("probeRbac swallows 404 (RBAC OK)", async () => {
    const { factory, k8sLog } = makeFactory();
    k8sLog.log.mockRejectedValueOnce(new Error("404 not found"));
    await expect(factory.probeRbac()).resolves.toBeUndefined();
  });

  it("probeRbac re-throws on 403 (RBAC missing)", async () => {
    const { factory, k8sLog } = makeFactory();
    k8sLog.log.mockRejectedValueOnce(new Error("403 forbidden: pods/log"));
    await expect(factory.probeRbac()).rejects.toThrow(/RBAC missing pods\/log/);
  });

  it("probeRbac swallows other errors (transient apiserver)", async () => {
    const { factory, k8sLog } = makeFactory();
    k8sLog.log.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(factory.probeRbac()).resolves.toBeUndefined();
  });
});
