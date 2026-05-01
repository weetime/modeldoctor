import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BenchmarkK8sReader, BenchmarkReconciler } from "./benchmark.reconciler.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";

const NOW = new Date("2026-04-26T12:00:00Z");

interface PrismaStub {
  run: {
    findMany: ReturnType<typeof vi.fn>;
  };
}
function buildPrisma(): PrismaStub {
  return {
    run: {
      findMany: vi.fn(),
    },
  };
}

interface RunsStub {
  update: ReturnType<typeof vi.fn>;
}
function buildRuns(): RunsStub {
  return {
    update: vi.fn(),
  };
}

function buildDriver(): BenchmarkExecutionDriver & {
  cancel: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(),
    cancel: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
}

function buildConfig(over: Record<string, unknown> = {}): ConfigService {
  return {
    get: (k: string) => {
      const map: Record<string, unknown> = {
        BENCHMARK_DRIVER: "subprocess",
        BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 60,
        BENCHMARK_K8S_NAMESPACE: "modeldoctor-benchmarks",
        ...over,
      };
      return map[k];
    },
  } as unknown as ConfigService;
}

function makeRunRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    status: "running",
    driverHandle: "subprocess:1",
    startedAt: new Date(NOW.getTime() - 10_000),
    createdAt: new Date(NOW.getTime() - 10_000),
    ...over,
  };
}

describe("BenchmarkReconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing when there are no active rows", async () => {
    const prisma = buildPrisma();
    const runs = buildRuns();
    prisma.run.findMany.mockResolvedValue([]);
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig() as never,
      null,
      runs as never,
    );
    await r.reconcile();
    expect(runs.update).not.toHaveBeenCalled();
  });

  it("subprocess: marks runaway-timeout row failed and calls driver.cancel", async () => {
    const prisma = buildPrisma();
    const runs = buildRuns();
    prisma.run.findMany.mockResolvedValue([
      makeRunRow({
        id: "r1",
        status: "running",
        driverHandle: "subprocess:1",
        startedAt: new Date(NOW.getTime() - 120_000), // 2min old, > 60s default
        createdAt: new Date(NOW.getTime() - 120_000),
      }),
    ]);
    runs.update.mockResolvedValue(makeRunRow({ id: "r1", status: "failed" }));
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig() as never,
      null,
      runs as never,
    );
    await r.reconcile();
    expect(drv.cancel).toHaveBeenCalledWith("subprocess:1");
    const upd = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(upd[1].status).toBe("failed");
    expect(upd[1].statusMessage).toMatch(/exceeded max duration/);
  });

  it("skips rows newer than 5 seconds (race with create)", async () => {
    const prisma = buildPrisma();
    const runs = buildRuns();
    prisma.run.findMany.mockResolvedValue([
      makeRunRow({
        id: "r1",
        status: "submitted",
        driverHandle: "subprocess:1",
        startedAt: new Date(NOW.getTime() - 1_000),
        createdAt: new Date(NOW.getTime() - 1_000),
      }),
    ]);
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig() as never,
      null,
      runs as never,
    );
    await r.reconcile();
    expect(runs.update).not.toHaveBeenCalled();
  });

  it("k8s: marks failed when readNamespacedJob 404s", async () => {
    const prisma = buildPrisma();
    const runs = buildRuns();
    prisma.run.findMany.mockResolvedValue([
      makeRunRow({
        id: "r1",
        status: "running",
        driverHandle: "modeldoctor-benchmarks/benchmark-r1",
        startedAt: new Date(NOW.getTime() - 30_000),
        createdAt: new Date(NOW.getTime() - 30_000),
      }),
    ]);
    runs.update.mockResolvedValue(makeRunRow({ id: "r1", status: "failed" }));
    const reader: BenchmarkK8sReader = {
      readJob: vi.fn(async () => {
        const e = new Error("not found") as Error & { statusCode: number };
        e.statusCode = 404;
        throw e;
      }),
      listJobPods: vi.fn(),
    };
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig({ BENCHMARK_DRIVER: "k8s" }) as never,
      reader,
      runs as never,
    );
    await r.reconcile();
    const upd = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(upd[1].status).toBe("failed");
    expect(upd[1].statusMessage).toMatch(/vanished/i);
  });

  it("k8s: marks failed with reason when pod terminated nonzero", async () => {
    const prisma = buildPrisma();
    const runs = buildRuns();
    prisma.run.findMany.mockResolvedValue([
      makeRunRow({
        id: "r1",
        status: "running",
        driverHandle: "modeldoctor-benchmarks/benchmark-r1",
        startedAt: new Date(NOW.getTime() - 30_000),
        createdAt: new Date(NOW.getTime() - 30_000),
      }),
    ]);
    runs.update.mockResolvedValue(makeRunRow({ id: "r1", status: "failed" }));
    const reader: BenchmarkK8sReader = {
      readJob: vi.fn(async () => ({ status: { failed: 1 } })),
      listJobPods: vi.fn(async () => [
        {
          status: {
            containerStatuses: [
              {
                state: { terminated: { reason: "OOMKilled", exitCode: 137 } },
              },
            ],
          },
        },
      ]),
    };
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig({ BENCHMARK_DRIVER: "k8s" }) as never,
      reader,
      runs as never,
    );
    await r.reconcile();
    const upd = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(upd[1].status).toBe("failed");
    expect(upd[1].statusMessage).toMatch(/OOMKilled|exit ?137/);
  });

  it("idempotent: re-running with already-terminal rows does nothing", async () => {
    const prisma = buildPrisma();
    const runs = buildRuns();
    prisma.run.findMany.mockResolvedValue([]);
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig() as never,
      null,
      runs as never,
    );
    await r.reconcile();
    await r.reconcile();
    expect(runs.update).not.toHaveBeenCalled();
  });
});
