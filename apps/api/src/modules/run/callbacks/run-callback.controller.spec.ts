import { describe, expect, it, vi, beforeEach } from "vitest";
import { RunCallbackController } from "./run-callback.controller.js";
import { SseHub } from "../sse/sse-hub.service.js";
import type { Run as PrismaRun } from "@prisma/client";

class MockRunRepo {
  private rows = new Map<string, Partial<PrismaRun>>();
  setup(id: string, row: Partial<PrismaRun>) { this.rows.set(id, row); }
  async findById(id: string) { return this.rows.get(id) as PrismaRun | undefined ?? null; }
  async update(id: string, patch: Record<string, unknown>) {
    const cur = this.rows.get(id) ?? {};
    const next = { ...cur, ...patch };
    this.rows.set(id, next);
    return next as PrismaRun;
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
      buildCommand: () => { throw new Error("not used"); },
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

describe("RunCallbackController", () => {
  let repo: MockRunRepo;
  let sse: SseHub;
  let ctrl: RunCallbackController;

  beforeEach(() => {
    repo = new MockRunRepo();
    sse = new SseHub();
    ctrl = new RunCallbackController(repo as never, sse);
  });

  it("/state running marks the row as running", async () => {
    repo.setup("r1", { id: "r1", tool: "guidellm", status: "submitted" });
    await ctrl.handleState("r1", { state: "running" });
    const row = await repo.findById("r1");
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
});
