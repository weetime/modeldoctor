import * as toolAdapters from "@modeldoctor/tool-adapters";
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
      parseFinalReport: (stdout: string) => {
        if (stdout === "BAD") throw new Error("simulated parse failure");
        return { tool: "guidellm", data: { ttft: { mean: 1, p50: 1, p90: 1, p95: 1, p99: 1 } } };
      },
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
    ctrl = new BenchmarkCallbackController(repo as never, sse, { emit: vi.fn() } as never);
  });

  it("/state running marks the row as running", async () => {
    repo.setup("r1", { id: "r1", tool: "guidellm", status: "submitted" });
    await ctrl.handleState("r1", { state: "running" });
    const row = await repo.findById("r1");
    expect(row?.status).toBe("running");
  });

  it("/state running with toolVersion sets both status and toolVersion on a pending row", async () => {
    repo.setup("r1", { id: "r1", tool: "guidellm", status: "submitted", toolVersion: null });
    await ctrl.handleState("r1", { state: "running", toolVersion: "guidellm 0.5.2" });
    const row = await repo.findById("r1");
    expect(row?.status).toBe("running");
    expect(row?.toolVersion).toBe("guidellm 0.5.2");
  });

  it("/state running without toolVersion preserves null toolVersion on a pending row", async () => {
    repo.setup("r1", { id: "r1", tool: "guidellm", status: "submitted", toolVersion: null });
    await ctrl.handleState("r1", { state: "running" });
    const row = await repo.findById("r1");
    expect(row?.status).toBe("running");
    expect(row?.toolVersion).toBeNull();
    // Verify the update patch did not include toolVersion (i.e. did not
    // overwrite an existing value with null).
    const lastPatch = repo.updateCalls.at(-1)?.patch;
    expect(lastPatch).toBeDefined();
    expect(Object.hasOwn(lastPatch as object, "toolVersion")).toBe(false);
  });

  it("/state with only toolVersion updates toolVersion on an already-running row", async () => {
    repo.setup("r1", {
      id: "r1",
      tool: "guidellm",
      status: "running",
      toolVersion: "guidellm 0.5.2",
    });
    await ctrl.handleState("r1", { toolVersion: "guidellm 0.5.3" } as never);
    const row = await repo.findById("r1");
    expect(row?.status).toBe("running");
    expect(row?.toolVersion).toBe("guidellm 0.5.3");
    const lastPatch = repo.updateCalls.at(-1)?.patch;
    expect(lastPatch).toEqual({ toolVersion: "guidellm 0.5.3" });
  });

  it("/state with identical toolVersion is a no-op (no extra update call)", async () => {
    repo.setup("r1", {
      id: "r1",
      tool: "guidellm",
      status: "running",
      toolVersion: "guidellm 0.5.2",
    });
    const before = repo.updateCalls.length;
    await ctrl.handleState("r1", { toolVersion: "guidellm 0.5.2" } as never);
    expect(repo.updateCalls.length).toBe(before);
    const row = await repo.findById("r1");
    expect(row?.toolVersion).toBe("guidellm 0.5.2");
    expect(row?.status).toBe("running");
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

  it("/finish parses report and writes summaryMetrics + rawOutput on success", async () => {
    repo.setup("r1", { id: "r1", tool: "guidellm", status: "running" });
    await ctrl.handleFinish("r1", {
      state: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      files: { report: Buffer.from('{"ok":true}', "utf8").toString("base64") },
    });
    const row = await repo.findById("r1");
    expect(row?.status).toBe("completed");
    expect((row?.summaryMetrics as { tool?: string })?.tool).toBe("guidellm");
    expect(row?.rawOutput).toEqual({
      stdout: "ok",
      stderr: "",
      files: { report: Buffer.from('{"ok":true}', "utf8").toString("base64") },
    });
  });

  it("/finish forces failed when adapter.parseFinalReport throws", async () => {
    repo.setup("r1", { id: "r1", tool: "guidellm", status: "running" });
    await ctrl.handleFinish("r1", {
      state: "completed", // runner reports completed but parser fails
      exitCode: 0,
      stdout: "BAD",
      stderr: "",
      files: {},
    });
    const row = await repo.findById("r1");
    expect(row?.status).toBe("failed");
    expect((row?.statusMessage as string | undefined) ?? "").toMatch(/report parse/);
    expect(row?.summaryMetrics).toBeNull();
  });

  it("/finish state=failed preserves runner message and does NOT call parseFinalReport", async () => {
    const parseFinalReport = vi.fn(() => {
      throw new Error("should not be called when state=failed");
    });
    vi.spyOn(toolAdapters, "byTool").mockReturnValueOnce({
      name: "guidellm",
      scenarios: ["inference"],
      paramsSchema: { parse: (x: unknown) => x } as never,
      reportSchema: { parse: (x: unknown) => x } as never,
      paramDefaults: {},
      buildCommand: () => ({ argv: [], env: {}, secretEnv: {}, outputFiles: {} }),
      parseProgress: () => null,
      parseFinalReport,
      getMaxDurationSeconds: () => 60,
      readMetric: () => null,
    });

    repo.setup("benchmark-1", { id: "benchmark-1", tool: "guidellm", status: "running" });
    await ctrl.handleFinish("benchmark-1", {
      state: "failed",
      exitCode: 137,
      message: "tool exited with code 137",
      stdout: "",
      stderr: "OSError: perf_analyzer not found",
      files: {},
    } as never);

    expect(parseFinalReport).not.toHaveBeenCalled();
    const row = await repo.findById("benchmark-1");
    expect(row).toMatchObject({
      status: "failed",
      statusMessage: "tool exited with code 137",
      summaryMetrics: null,
    });
  });
});
