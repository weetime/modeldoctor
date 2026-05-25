import type { Benchmark as PrismaBenchmark } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SseHub } from "../sse/sse-hub.service.js";
import { BenchmarkCallbackController } from "./benchmark-callback.controller.js";

class MockBenchmarkRepo {
  private rows = new Map<string, Partial<PrismaBenchmark>>();
  updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
  setup(id: string, row: Partial<PrismaBenchmark>) {
    this.rows.set(id, row);
  }
  async findById(id: string) {
    return (this.rows.get(id) as PrismaBenchmark | undefined) ?? null;
  }
  async update(id: string, patch: Record<string, unknown>) {
    this.updateCalls.push({ id, patch });
    const cur = this.rows.get(id) ?? {};
    const next = { ...cur, ...patch };
    this.rows.set(id, next);
    return next as PrismaBenchmark;
  }
}

// Stub adapter registry to avoid pulling in the real (stubbed) adapters.
vi.mock("@modeldoctor/tool-adapters", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    byTool: () => ({
      name: "guidellm",
      paramsSchema: { parse: (x: unknown) => x },
      reportSchema: { parse: (x: unknown) => x },
      paramDefaults: {},
      buildCommand: () => {
        throw new Error("not used");
      },
      parseProgress: (line: string) =>
        line.startsWith("PROGRESS:")
          ? { kind: "progress", pct: Number.parseFloat(line.slice("PROGRESS:".length)) }
          : { kind: "log", level: "info", line },
    }),
  };
});

describe("BenchmarkCallbackController", () => {
  let repo: MockBenchmarkRepo;
  let sse: SseHub;
  let ctrl: BenchmarkCallbackController;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = new MockBenchmarkRepo();
    sse = new SseHub();
    ctrl = new BenchmarkCallbackController(repo as never, sse);
  });

  it("/log invokes adapter.parseProgress and publishes ProgressEvent", async () => {
    repo.setup("r1", { id: "r1", tool: "guidellm", status: "running" });
    const evts: unknown[] = [];
    sse.subscribe("r1").subscribe((e) => evts.push(e));
    await ctrl.handleLog("r1", { stream: "stdout", lines: ["PROGRESS:0.42", "hello world"] });
    expect(evts).toHaveLength(2);
    expect((evts[0] as { kind: string }).kind).toBe("progress");
    expect((evts[1] as { kind: string }).kind).toBe("log");
  });
});
