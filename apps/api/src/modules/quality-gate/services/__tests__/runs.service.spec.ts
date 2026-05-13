import { describe, expect, it, vi } from "vitest";
import { RunsService } from "../runs.service.js";

function build() {
  const repo = {
    createPending: vi.fn().mockResolvedValue({ id: "r1", status: "PENDING" }),
    findById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    deleteRun: vi.fn(),
  };
  const evaluationsRepo = {
    get: vi.fn().mockResolvedValue({
      id: "e1",
      userId: "u1",
      version: 2,
      samples: [
        { id: "s", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } },
      ],
      baselineRunId: null,
    }),
  };
  const connections = {
    // Mirrors ConnectionService.findOwnedPublic(userId, id)
    findOwnedPublic: vi.fn().mockResolvedValue({ id: "c", userId: "u1" }),
  };
  const executor = { start: vi.fn(), cancel: vi.fn() };
  return { repo, evaluationsRepo, connections, executor };
}

describe("RunsService", () => {
  it("rejects when evaluation not owned by user", async () => {
    const m = build();
    m.evaluationsRepo.get.mockResolvedValueOnce(null);
    const svc = new RunsService(
      m.repo as never,
      m.evaluationsRepo as never,
      m.connections as never,
      m.executor as never,
    );
    await expect(
      svc.create("u1", { evaluationId: "x", endpointAId: "c", gateConfig: { passRateMin: 0.9 } }),
    ).rejects.toThrow();
  });
  it("create snapshots evaluation samples and fires executor", async () => {
    const m = build();
    const svc = new RunsService(
      m.repo as never,
      m.evaluationsRepo as never,
      m.connections as never,
      m.executor as never,
    );
    const r = await svc.create("u1", {
      evaluationId: "e1",
      endpointAId: "c",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(m.repo.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ evaluationVersion: 2 }),
    );
    expect(m.executor.start).toHaveBeenCalledWith("r1");
    expect(r.id).toBe("r1");
  });
  it("cancel forwards to executor when run owned by user", async () => {
    const m = build();
    m.repo.findById.mockResolvedValueOnce({ id: "r1", status: "RUNNING", userId: "u1" });
    const svc = new RunsService(
      m.repo as never,
      m.evaluationsRepo as never,
      m.connections as never,
      m.executor as never,
    );
    await svc.cancel("u1", "r1");
    expect(m.executor.cancel).toHaveBeenCalledWith("r1");
  });

  it("create with baselineRunIdOverride=undefined picks up evaluation's pinned baseline", async () => {
    const m = build();
    m.evaluationsRepo.get.mockResolvedValue({
      id: "e1",
      userId: "u1",
      version: 2,
      samples: [{ id: "s", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }],
      baselineRunId: "pinned-run",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await svc.create("u1", {
      evaluationId: "e1",
      endpointAId: "c",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(m.repo.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ baselineRunIdAtExecution: "pinned-run" }),
    );
  });

  it("create with baselineRunIdOverride=null explicitly skips evaluation's pin", async () => {
    const m = build();
    m.evaluationsRepo.get.mockResolvedValue({
      id: "e1",
      userId: "u1",
      version: 2,
      samples: [{ id: "s", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }],
      baselineRunId: "pinned-run",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await svc.create("u1", {
      evaluationId: "e1",
      endpointAId: "c",
      baselineRunIdOverride: null,
      gateConfig: { passRateMin: 0.9 },
    });
    expect(m.repo.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ baselineRunIdAtExecution: null }),
    );
  });

  it("create with baselineRunIdOverride=string validates the run and uses it", async () => {
    const m = build();
    m.repo.findById.mockResolvedValueOnce({
      id: "override-run",
      userId: "u1",
      evaluationId: "e1",
      status: "COMPLETED",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await svc.create("u1", {
      evaluationId: "e1",
      endpointAId: "c",
      baselineRunIdOverride: "override-run",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(m.repo.findById).toHaveBeenCalledWith("u1", "override-run");
    expect(m.repo.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ baselineRunIdAtExecution: "override-run" }),
    );
  });

  it("create rejects baselineRunIdOverride pointing to RUNNING run", async () => {
    const m = build();
    m.repo.findById.mockResolvedValueOnce({
      id: "override-run",
      userId: "u1",
      evaluationId: "e1",
      status: "RUNNING",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await expect(
      svc.create("u1", {
        evaluationId: "e1",
        endpointAId: "c",
        baselineRunIdOverride: "override-run",
        gateConfig: { passRateMin: 0.9 },
      }),
    ).rejects.toThrow(/must be COMPLETED/);
  });
});
