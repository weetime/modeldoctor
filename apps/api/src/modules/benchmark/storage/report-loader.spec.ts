import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportLoader, type ReportLoaderDeps } from "./report-loader.js";
import type { ReportStorage } from "./report-storage.js";

const fixtureMeta = { toolVersion: "guidellm 0.2.1", startTimeIso: "2026-05-25T00:00:00.000Z" };
const fixtureResult = {
  exitCode: 0,
  finishTimeIso: "2026-05-25T01:00:00.000Z",
  files: { "report.json": "files/report.json" },
};

function makeDeps() {
  const storage = {
    exists: vi.fn(async () => true),
    readJson: vi.fn(async (k: string) => {
      if (k.endsWith("meta.json")) return fixtureMeta;
      if (k.endsWith("result.json")) return fixtureResult;
      throw new Error(`unexpected key ${k}`);
    }),
    readText: vi.fn(async () => "stdout content"),
    readBytes: vi.fn(async () => Buffer.from("file content")),
  } as unknown as ReportStorage;
  const repo = {
    findById: vi.fn(async (id: string) => ({
      id,
      status: "running",
      tool: "guidellm",
      userId: "u1",
      name: "n",
      scenario: "inference",
      connectionId: null,
    })),
    updateGuarded: vi.fn(async () => ({ id: "r1" })),
  };
  const notify = { emit: vi.fn(async () => {}) };
  const sse = { close: vi.fn() };
  const adapter = {
    parseFinalReport: vi.fn(() => ({ tool: "guidellm" as const, data: { latency: 42 } })),
  };
  const byTool = vi.fn(() => adapter);
  return { storage, repo, notify, sse, byTool, adapter };
}

function newLoader(d: ReturnType<typeof makeDeps>): ReportLoader {
  return new ReportLoader({
    storage: d.storage,
    repo: d.repo as never,
    notify: d.notify as never,
    sse: d.sse as never,
    byTool: d.byTool as never,
  } as ReportLoaderDeps);
}

describe("ReportLoader", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("success path → updateGuarded(completed) + notify benchmark.completed", async () => {
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.arrayContaining(["submitted", "running"]),
      expect.objectContaining({ status: "completed", toolVersion: "guidellm 0.2.1" }),
    );
    expect(deps.notify.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "benchmark.completed" }),
    );
    expect(deps.sse.close).toHaveBeenCalledWith("r1");
  });

  it("storage timeout → updateGuarded(failed) + notify benchmark.failed", async () => {
    (deps.storage.readJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("timeout"));
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringContaining("report load"),
      }),
    );
  });

  it("file missing → updateGuarded(failed)", async () => {
    (deps.storage.readJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("NotFound"), { name: "NotFound" }),
    );
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("parse failure → updateGuarded(failed)", async () => {
    deps.adapter.parseFinalReport = vi.fn(() => {
      throw new Error("bad json");
    });
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringContaining("report load: bad json"),
      }),
    );
  });

  it("benchmark already terminal → noop (no storage reads)", async () => {
    deps.repo.findById = vi.fn(async () => ({
      id: "r1",
      status: "cancelled",
      tool: "guidellm",
      userId: "u1",
      name: "n",
      scenario: "inference",
      connectionId: null,
    }));
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.storage.readJson).not.toHaveBeenCalled();
    expect(deps.repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("guard race: updateGuarded returns null → no notify", async () => {
    deps.repo.updateGuarded = vi.fn(async () => null) as never;
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.notify.emit).not.toHaveBeenCalled();
  });
});
