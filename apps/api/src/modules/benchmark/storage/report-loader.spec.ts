import type { ToolReport } from "@modeldoctor/tool-adapters";
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
      connection: null,
      startedAt: new Date("2026-05-25T00:00:00.000Z"),
    })),
    updateGuarded: vi.fn(async () => ({
      id: "r1",
      completedAt: new Date("2026-05-25T01:00:00.000Z"),
    })),
    mergeServerMetrics: vi.fn(async () => {}),
  };
  const notify = { emit: vi.fn(async () => {}) };
  const sse = { close: vi.fn() };
  const adapter = {
    // Cast: this fixture is intentionally a minimal stand-in, not a full
    // GuidellmReport — the mock's declared return type is the ToolReport
    // union so any other tool's shape (e.g. tau3, in makeTau3Deps below) can
    // be assigned to the same field without a structural-mismatch error.
    parseFinalReport: vi.fn(() => ({ tool: "guidellm" as const, data: { latency: 42 } }) as unknown as ToolReport),
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
    })) as never;
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

  it("files total > 500MB → updateGuarded(failed) with 'exceed' statusMessage", async () => {
    // Create a fake Buffer with .length=400MB without actually allocating that memory
    const fake400MB = Buffer.alloc(0);
    Object.defineProperty(fake400MB, "length", { value: 400 * 1024 * 1024 });
    (deps.storage.readBytes as ReturnType<typeof vi.fn>).mockResolvedValue(fake400MB);
    // Two files each 400MB → total 800MB → cap blown on second iteration
    (deps.storage.readJson as ReturnType<typeof vi.fn>).mockImplementation(async (k: string) => {
      if (k.endsWith("meta.json")) return fixtureMeta;
      if (k.endsWith("result.json"))
        return { ...fixtureResult, files: { a: "files/a.bin", b: "files/b.bin" } };
      throw new Error(`unexpected key ${k}`);
    });
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringContaining("exceed"),
      }),
    );
  });
});

// ── Prefix-cache snapshot hook (gating logic) ─────────────────────────────────

function makePrefixCacheDeps() {
  const base = makeDeps();
  // Bench is a lb-strategy scenario with a connection that has an
  // explicit prometheusDatasourceId binding.
  (base.repo.findById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ({
    id,
    status: "running",
    tool: "aiperf",
    userId: "u1",
    name: "pcv",
    scenario: "lb-strategy",
    connectionId: "conn-1",
    connection: {
      id: "conn-1",
      name: "my-conn",
      model: "meta-llama/Llama-3-8B",
      baseUrl: "http://vllm",
      prometheusDatasourceId: "ds-1",
    },
    startedAt: new Date("2026-05-25T00:00:00.000Z"),
  }));
  (base.repo.updateGuarded as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
    id: "r1",
    completedAt: new Date("2026-05-25T01:00:00.000Z"),
  }));

  const fakeAnnotation = {
    metricTag: "v1" as const,
    hitRatePct: 75,
    topPodSharePct: 100,
    perPod: [{ pod: "p1", queries: 100, hits: 75 }],
  };
  const prefixCacheSnapshot = { snapshot: vi.fn(async () => fakeAnnotation) };
  const promFetcher = {
    resolveDatasourceByRef: vi.fn(async () => ({
      id: "ds-1",
      name: "prom",
      baseUrl: "http://prom",
    })),
  };
  return { ...base, prefixCacheSnapshot, promFetcher, fakeAnnotation };
}

function newPrefixCacheLoader(d: ReturnType<typeof makePrefixCacheDeps>): ReportLoader {
  return new ReportLoader({
    storage: d.storage,
    repo: d.repo as never,
    notify: d.notify as never,
    sse: d.sse as never,
    byTool: d.byTool as never,
    prefixCacheSnapshot: d.prefixCacheSnapshot as never,
    promFetcher: d.promFetcher as never,
  });
}

describe("ReportLoader – prefix-cache snapshot hook", () => {
  let deps: ReturnType<typeof makePrefixCacheDeps>;
  beforeEach(() => {
    deps = makePrefixCacheDeps();
  });

  it("snapshots and calls mergeServerMetrics when scenario=lb-strategy and ds resolves", async () => {
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    // Must use the datasourceId path (not connectionId) so we never fall back
    // to the workspace-default datasource.
    expect(deps.promFetcher.resolveDatasourceByRef).toHaveBeenCalledWith({ datasourceId: "ds-1" });
    expect(deps.prefixCacheSnapshot.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ model: "meta-llama/Llama-3-8B", windowSec: expect.any(Number) }),
    );
    expect(deps.repo.mergeServerMetrics).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ prefixCache: deps.fakeAnnotation }),
    );
    // Completion path is still correct — snapshot is additive, not blocking
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("skips snapshot when scenario != lb-strategy (no promFetcher call)", async () => {
    (deps.repo.findById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ({
      id,
      status: "running",
      tool: "guidellm",
      userId: "u1",
      name: "n",
      scenario: "inference",
      connectionId: "conn-1",
      connection: {
        id: "conn-1",
        name: "c",
        model: "m",
        baseUrl: "http://vllm",
        prometheusDatasourceId: "ds-1",
      },
      startedAt: new Date(),
    }));
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.promFetcher.resolveDatasourceByRef).not.toHaveBeenCalled();
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
    // Completion path unaffected
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("skips snapshot when connectionId is null", async () => {
    (deps.repo.findById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ({
      id,
      status: "running",
      tool: "aiperf",
      userId: "u1",
      name: "pcv",
      scenario: "lb-strategy",
      connectionId: null,
      connection: null,
      startedAt: new Date(),
    }));
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.promFetcher.resolveDatasourceByRef).not.toHaveBeenCalled();
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
  });

  it("skips mergeServerMetrics when snapshot returns null (no Prom data)", async () => {
    deps.prefixCacheSnapshot.snapshot = vi.fn(async () => null) as never;
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
    // Completion path still succeeds
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("snapshot error does NOT affect completion path (best-effort guarantee)", async () => {
    deps.prefixCacheSnapshot.snapshot = vi.fn(async () => {
      throw new Error("prom network error");
    }) as never;
    const loader = newPrefixCacheLoader(deps);
    // Must not throw
    await expect(loader.tryLoad("r1")).resolves.toBeUndefined();
    // Completion was still recorded
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({ status: "completed" }),
    );
    expect(deps.notify.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "benchmark.completed" }),
    );
    // mergeServerMetrics was NOT called (snapshot failed before it)
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
  });

  it("skips snapshot when connection has no prometheusDatasourceId binding (graceful degrade, no default fallback)", async () => {
    // The connection exists but has no bound datasource — we must NOT fall
    // back to the workspace default.
    (deps.repo.findById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ({
      id,
      status: "running",
      tool: "aiperf",
      userId: "u1",
      name: "pcv",
      scenario: "lb-strategy",
      connectionId: "conn-1",
      connection: {
        id: "conn-1",
        name: "my-conn",
        model: "meta-llama/Llama-3-8B",
        baseUrl: "http://vllm",
        prometheusDatasourceId: null,
      },
      startedAt: new Date("2026-05-25T00:00:00.000Z"),
    }));
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    // resolveDatasourceByRef must NOT be called — we skip before reaching it
    expect(deps.promFetcher.resolveDatasourceByRef).not.toHaveBeenCalled();
    expect(deps.prefixCacheSnapshot.snapshot).not.toHaveBeenCalled();
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
  });

  it("skips snapshot when ds is not found by explicit id (deleted datasource)", async () => {
    // prometheusDatasourceId is set but resolveDatasourceByRef returns null
    // (datasource was deleted) — should still degrade gracefully.
    deps.promFetcher.resolveDatasourceByRef = vi.fn(async () => null) as never;
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.prefixCacheSnapshot.snapshot).not.toHaveBeenCalled();
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
  });

  it("skips snapshot when startedAt is null (benchmark never started)", async () => {
    (deps.repo.findById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ({
      id,
      status: "running",
      tool: "aiperf",
      userId: "u1",
      name: "pcv",
      scenario: "lb-strategy",
      connectionId: "conn-1",
      connection: {
        id: "conn-1",
        name: "my-conn",
        model: "meta-llama/Llama-3-8B",
        baseUrl: "http://vllm",
        prometheusDatasourceId: "ds-1",
      },
      startedAt: null,
    }));
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.promFetcher.resolveDatasourceByRef).not.toHaveBeenCalled();
    expect(deps.prefixCacheSnapshot.snapshot).not.toHaveBeenCalled();
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
    // Completion path still succeeds
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("guard race: updateGuarded returns null → snapshot is NOT attempted", async () => {
    // Another worker completed this benchmark first; updateGuarded returns null.
    // trySnapshotPrefixCache must not be called — it would use a null completedAt
    // window and double-trigger on a row someone else already owns.
    deps.repo.updateGuarded = vi.fn(async () => null) as never;
    const loader = newPrefixCacheLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.promFetcher.resolveDatasourceByRef).not.toHaveBeenCalled();
    expect(deps.prefixCacheSnapshot.snapshot).not.toHaveBeenCalled();
    expect(deps.repo.mergeServerMetrics).not.toHaveBeenCalled();
    // Notify should also be suppressed (existing guard-race behavior)
    expect(deps.notify.emit).not.toHaveBeenCalled();
  });
});

// ── tau3 gate merge ───────────────────────────────────────────────────────

function makeTau3Deps(over: { baselineId?: string | null; gate?: unknown } = {}) {
  const base = makeDeps();
  (base.repo.findById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ({
    id,
    status: "running",
    tool: "tau3",
    userId: "u1",
    name: "agent-run",
    scenario: "agent",
    connectionId: "conn-1",
    connection: { id: "conn-1", name: "c", model: "m", baseUrl: "http://vllm" },
    startedAt: new Date("2026-05-25T00:00:00.000Z"),
    baselineId: over.baselineId ?? null,
    params: { domains: ["airline"], gate: over.gate ?? { mode: "off" } },
  }));
  const tau3Report = {
    kind: "agent-tau3" as const,
    userSimModel: "deepseek-v3",
    numTrials: 3,
    overall: { pass1: 0.4, passK: 0.4, tasks: 20 },
    perDomain: { airline: { pass1: 0.4, passK: 0.4, tasks: 20 } },
    attribution: {},
    highlights: {
      successSimId: null,
      successDomain: null,
      failureSimId: null,
      failureDomain: null,
    },
  };
  base.adapter.parseFinalReport = vi.fn(
    () => ({ tool: "tau3" as const, data: tau3Report }) as unknown as ToolReport,
  );
  const findBaselineOverallPass1 = vi.fn(async () => null as number | null);
  (base.repo as unknown as { findBaselineOverallPass1: typeof findBaselineOverallPass1 }).findBaselineOverallPass1 =
    findBaselineOverallPass1;
  return { ...base, findBaselineOverallPass1 };
}

describe("ReportLoader – tau3 gate merge", () => {
  it("perDomainFloor below floor → summary.data.gate.result === 'FAILED'", async () => {
    const deps = makeTau3Deps({ gate: { mode: "perDomainFloor", perDomainFloor: { airline: 0.9 } } });
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    const call = (deps.repo.updateGuarded as ReturnType<typeof vi.fn>).mock.calls[0];
    const patch = call[2] as { summaryMetrics: { data: { gate: { result: string } } } };
    expect(patch.summaryMetrics.data.gate.result).toBe("FAILED");
  });

  it("perDomainFloor at/above floor → summary.data.gate.result === 'PASSED'", async () => {
    const deps = makeTau3Deps({ gate: { mode: "perDomainFloor", perDomainFloor: { airline: 0.3 } } });
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    const call = (deps.repo.updateGuarded as ReturnType<typeof vi.fn>).mock.calls[0];
    const patch = call[2] as { summaryMetrics: { data: { gate: { result: string } } } };
    expect(patch.summaryMetrics.data.gate.result).toBe("PASSED");
  });

  it("mode='off' → gate.result is null and no baseline lookup is attempted", async () => {
    const deps = makeTau3Deps({ gate: { mode: "off" } });
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    const call = (deps.repo.updateGuarded as ReturnType<typeof vi.fn>).mock.calls[0];
    const patch = call[2] as { summaryMetrics: { data: { gate: { result: string | null } } } };
    expect(patch.summaryMetrics.data.gate.result).toBeNull();
    expect(deps.findBaselineOverallPass1).not.toHaveBeenCalled();
  });

  it("baselineRegression mode with a baselineId loads the baseline's overall pass^1", async () => {
    const deps = makeTau3Deps({
      baselineId: "bl-1",
      gate: { mode: "baselineRegression", baselineRegressionPp: 5 },
    });
    deps.findBaselineOverallPass1.mockResolvedValue(0.9);
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.findBaselineOverallPass1).toHaveBeenCalledWith("bl-1");
    const call = (deps.repo.updateGuarded as ReturnType<typeof vi.fn>).mock.calls[0];
    const patch = call[2] as { summaryMetrics: { data: { gate: { result: string } } } };
    // baseline pass1=0.9, run pass1=0.4 → -50pp drop, way over the 5pp threshold
    expect(patch.summaryMetrics.data.gate.result).toBe("FAILED");
  });

  it("non-tau3 tool: gate path is not invoked (summary passes through unchanged)", async () => {
    const deps = makeDeps(); // tool: "guidellm" by default
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    const call = (deps.repo.updateGuarded as ReturnType<typeof vi.fn>).mock.calls[0];
    const patch = call[2] as { summaryMetrics: { data: Record<string, unknown> } };
    expect(patch.summaryMetrics.data).toEqual({ latency: 42 });
    expect(patch.summaryMetrics.data.gate).toBeUndefined();
  });
});
