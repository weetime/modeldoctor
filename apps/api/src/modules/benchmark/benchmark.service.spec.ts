import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Prisma, type Benchmark as PrismaBenchmark } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaselineService } from "../baseline/baseline.service.js";
import { BenchmarkTemplateRepository } from "../benchmark-template/benchmark-template.repository.js";
import type { ConnectionService } from "../connection/connection.service.js";
import { BenchmarkRepository, type BenchmarkWithRelations } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import type { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";

// Stub adapter registry to avoid pulling in the real (stubbed) adapters'
// buildCommand / paramsSchema implementations. We also stub
// applyScenarioConstraints by default so existing happy-path tests can
// pass `params: {}`; tests that need the real scenario narrowing (the
// "scenario validation" describe block) restore the real implementation
// per-test via a saved reference.
vi.mock("@modeldoctor/tool-adapters", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  // Preserve real applyScenarioConstraints under a different name so the
  // scenario-validation tests can opt into the actual zod merging logic.
  return {
    ...actual,
    __realApplyScenarioConstraints: actual.applyScenarioConstraints,
    applyScenarioConstraints: () => ({ parse: (x: unknown) => x }),
    byTool: () => ({
      name: "guidellm",
      // Default stub claims to support both inference and capacity so the
      // standard create-path tests don't hit the scenario-tool mismatch
      // guard in BenchmarkService.create. Tests that need to assert the
      // mismatch (e.g. vegeta+capacity) override `byTool` per-test.
      scenarios: ["inference", "capacity"],
      paramsSchema: { parse: (x: unknown) => x },
      reportSchema: { parse: (x: unknown) => x },
      paramDefaults: {},
      buildCommand: () => ({
        argv: ["echo", "hi"],
        env: {},
        secretEnv: {},
        outputFiles: { report: "report.json" },
      }),
      parseProgress: () => null,
      parseFinalReport: () => ({ tool: "guidellm", data: {} }),
      getMaxDurationSeconds: () => 1800,
      // Minimal readMetric stub: just walk the shapes the report-summary
      // tests below construct (`data.e2eLatency.p95`, `data.latencies.p95`).
      // BenchmarkService.getByConnectionReports calls `byTool(tool).readMetric`
      // via `readP95LatencyMs`, so the stub has to honor that contract.
      readMetric: (kind: string, data: Record<string, unknown>) => {
        if (kind === "e2e.p95") {
          const e = (data.e2eLatency as { p95?: number } | undefined)?.p95;
          if (typeof e === "number" && Number.isFinite(e)) return e;
          const l = (data.latencies as { p95?: number } | undefined)?.p95;
          return typeof l === "number" && Number.isFinite(l) ? l : null;
        }
        return null;
      },
    }),
  };
});

const ENV_DEFAULTS: Record<string, unknown> = {
  BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 1800,
  RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:test",
  RUNNER_IMAGE_VEGETA: "md-runner-vegeta:test",
};

function mockConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const merged = { ...ENV_DEFAULTS, ...overrides };
  return { get: vi.fn((k: string) => merged[k]) } as unknown as ConfigService;
}

function makeBenchmarkRow(over: Partial<BenchmarkWithRelations> = {}): BenchmarkWithRelations {
  const base: Partial<BenchmarkWithRelations> = {
    id: "b1",
    userId: "u1",
    connectionId: "c1",
    connection: {
      id: "c1",
      name: "conn",
      model: "m",
      baseUrl: "http://x",
      prometheusDatasourceId: null,
    },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: "smoke",
    description: null,
    status: "pending",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: new Date("2026-05-02T00:00:00Z"),
    startedAt: null,
    completedAt: null,
  };
  return { ...base, ...over } as BenchmarkWithRelations;
}

class MockRepo {
  rows = new Map<string, BenchmarkWithRelations>();
  countResult = 0;
  setup(row: BenchmarkWithRelations) {
    this.rows.set(row.id, row);
  }
  findById = vi.fn(async (id: string) => this.rows.get(id) ?? null);
  list = vi.fn(async () => ({ items: [...this.rows.values()], nextCursor: null }));
  create = vi.fn(async (input: { userId: string; name: string; tool: string }) => {
    const row = makeBenchmarkRow({
      id: `gen-${this.rows.size + 1}`,
      userId: input.userId,
      name: input.name,
      tool: input.tool as BenchmarkWithRelations["tool"],
    });
    this.rows.set(row.id, row);
    return row as unknown as PrismaBenchmark;
  });
  update = vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const cur = this.rows.get(id) as BenchmarkWithRelations | undefined;
    if (!cur) throw new Error("not found");
    const next = { ...cur, ...patch } as BenchmarkWithRelations;
    this.rows.set(id, next);
    return next as unknown as PrismaBenchmark;
  });
  delete = vi.fn(async (id: string) => {
    const cur = this.rows.get(id);
    this.rows.delete(id);
    return cur as unknown as PrismaBenchmark;
  });
  countActiveByName = vi.fn(async (_u: string, _n: string) => this.countResult);
  // Existence probe used by BenchmarkService.create when validating
  // `parentBenchmarkId`. Tests that need a miss override this to false.
  existsById = vi.fn(async (id: string) => this.rows.has(id));
}

class MockBaselineService {
  ids = new Set<string>();
  setup(id: string) {
    this.ids.add(id);
  }
  existsById = vi.fn(async (id: string) => this.ids.has(id));
}

// Mock cast to K8sBenchmarkRunner — only the public methods that
// BenchmarkService actually calls (start / cancel / cleanup) need to
// be present. The class also holds private fields (namespace, batch,
// core, log) that we don't need to satisfy with a real mock.
const mockRunner = {
  start: vi.fn(async () => ({ handle: "subprocess:1234" })),
  cancel: vi.fn(async () => undefined),
  cleanup: vi.fn(async () => undefined),
} as unknown as K8sBenchmarkRunner;

const mockConnections: ConnectionService = {
  getOwnedDecrypted: vi.fn(async () => ({
    id: "c1",
    name: "conn",
    baseUrl: "http://upstream/",
    apiKey: "k",
    model: "m",
    customHeaders: "{}",
    queryParams: "",
    tokenizerHfId: null,
    prometheusDatasource: null,
    prometheusDatasourceId: null,
    serverKind: null,
    category: "text" as const,
  })),
} as unknown as ConnectionService;

class MockTemplateRepo {
  rows = new Map<string, { id: string; scenario: string; tool: string }>();
  setup(row: { id: string; scenario: string; tool: string }) {
    this.rows.set(row.id, row);
  }
  findByIdOrNull = vi.fn(async (id: string) => this.rows.get(id) ?? null);
}

function build(
  repo: MockRepo,
  configOverrides?: Record<string, unknown>,
  templateRepo?: MockTemplateRepo,
  baselineSvc?: MockBaselineService,
) {
  return new BenchmarkService(
    repo as unknown as BenchmarkRepository,
    mockRunner,
    mockConfig(configOverrides) as unknown as ConfigService<typeof ENV_DEFAULTS, true>,
    mockConnections,
    (templateRepo ?? new MockTemplateRepo()) as unknown as BenchmarkTemplateRepository,
    (baselineSvc ?? new MockBaselineService()) as unknown as BaselineService,
    { connection: { findMany: vi.fn() } } as never,
    { emit: vi.fn() } as never,
  );
}

describe("BenchmarkService.findById / list", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("findById returns ISO-stringified row", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1" }));
    const dto = await svc.findById("b1");
    expect(typeof dto?.createdAt).toBe("string");
    expect(dto?.id).toBe("b1");
  });

  it("findByIdOrFail throws when missing", async () => {
    await expect(svc.findByIdOrFail("nope")).rejects.toThrow(NotFoundException);
  });

  it("findByIdOrFail throws when user mismatch", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", userId: "u1" }));
    await expect(svc.findByIdOrFail("b1", "other")).rejects.toThrow(NotFoundException);
  });
});

describe("BenchmarkService.create", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("creates → starts and returns the started Benchmark", async () => {
    const dto = await svc.create("u1", {
      tool: "guidellm",
      scenario: "inference",
      connectionId: "c1",
      name: "smoke",
      params: {},
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(mockRunner.start).toHaveBeenCalledTimes(1);
    expect(dto.status).toBe("submitted");
    expect(dto.driverHandle).toBe("subprocess:1234");
  });

  it("throws ConflictException when an active benchmark with the same name exists", async () => {
    repo.countResult = 1;
    await expect(
      svc.create("u1", {
        tool: "guidellm",
        scenario: "inference",
        connectionId: "c1",
        name: "smoke",
        params: {},
      }),
    ).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("BenchmarkService.cancel", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("marks benchmark as canceled and calls driver.cancel when handle exists", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "running", driverHandle: "subprocess:1234" }));
    const dto = await svc.cancel("b1", "u1");
    expect(mockRunner.cancel).toHaveBeenCalledWith("subprocess:1234");
    expect(dto.status).toBe("canceled");
    expect(dto.completedAt).not.toBeNull();
  });

  it("does NOT call driver.cancel when status is pending", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "pending", driverHandle: null }));
    await svc.cancel("b1", "u1");
    expect(mockRunner.cancel).not.toHaveBeenCalled();
  });

  it("throws BadRequestException when benchmark is already terminal", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "completed" }));
    await expect(svc.cancel("b1", "u1")).rejects.toThrow(BadRequestException);
  });
});

describe("BenchmarkService.delete", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("deletes a terminal benchmark without calling driver.cancel", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "completed" }));
    await svc.delete("b1", "u1");
    expect(repo.delete).toHaveBeenCalledWith("b1");
    expect(mockRunner.cancel).not.toHaveBeenCalled();
  });

  it("deletes a submitted benchmark and best-effort cancels driver", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "submitted", driverHandle: "k8s:job-1" }));
    await svc.delete("b1", "u1");
    expect(mockRunner.cancel).toHaveBeenCalledWith("k8s:job-1");
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });

  it("deletes a running benchmark even when driver.cancel throws", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "running", driverHandle: "k8s:job-2" }));
    (mockRunner.cancel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("apiserver flake"),
    );
    await svc.delete("b1", "u1");
    expect(mockRunner.cancel).toHaveBeenCalledWith("k8s:job-2");
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });

  it("does not call driver.cancel when driverHandle is null", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "submitted", driverHandle: null }));
    await svc.delete("b1", "u1");
    expect(mockRunner.cancel).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });
});

describe("BenchmarkService.create — failure paths", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("throws BadRequestException when paramsSchema.parse rejects", async () => {
    // Override the global byTool stub for this one test
    const adapters = await import("@modeldoctor/tool-adapters");
    const orig = adapters.byTool;
    (adapters as { byTool: typeof orig }).byTool = (() => ({
      name: "guidellm",
      scenarios: ["inference", "capacity"],
      paramsSchema: {
        parse: () => {
          throw new Error("bad params");
        },
      },
      reportSchema: { parse: (x: unknown) => x },
      paramDefaults: {},
      buildCommand: () => ({ argv: [], env: {}, secretEnv: {}, outputFiles: {} }),
      parseProgress: () => null,
      parseFinalReport: () => ({ tool: "guidellm" as const, data: {} }),
      getMaxDurationSeconds: () => 1800,
    })) as unknown as typeof orig;
    try {
      await expect(
        svc.create("u1", {
          tool: "guidellm",
          scenario: "inference",
          connectionId: "c1",
          name: "smoke",
          params: { bad: true },
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    } finally {
      (adapters as { byTool: typeof orig }).byTool = orig;
    }
  });
});

describe("BenchmarkService.start — failure path", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("marks benchmark as failed when driver.start throws and re-raises", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", userId: "u1", connectionId: "c1", status: "pending" }));
    (mockRunner.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    await expect(svc.start("b1")).rejects.toThrow(/boom/);
    const row = await repo.findById("b1");
    expect(row?.status).toBe("failed");
    expect(row?.statusMessage).toContain("boom");
    expect(row?.completedAt).not.toBeNull();
  });
});

describe("BenchmarkService.cancel — driver-error path", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("re-raises driver errors and leaves row in its prior status", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "running", driverHandle: "subprocess:1234" }));
    (mockRunner.cancel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("apiserver flake"),
    );
    await expect(svc.cancel("b1", "u1")).rejects.toThrow(/apiserver flake/);
    const row = await repo.findById("b1");
    expect(row?.status).toBe("running"); // NOT canceled
  });
});

describe("admin elevation (userId === undefined)", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("cancel succeeds across user boundaries when userId is undefined", async () => {
    // benchmark owned by "owner" — elevation caller passes undefined
    repo.setup(
      makeBenchmarkRow({
        id: "b-elev-cancel",
        userId: "owner",
        status: "running",
        driverHandle: "subprocess:elev",
      }),
    );
    const dto = await svc.cancel("b-elev-cancel", undefined);
    expect(dto.status).toBe("canceled");
  });

  it("delete succeeds across user boundaries when userId is undefined", async () => {
    repo.setup(makeBenchmarkRow({ id: "b-elev-delete", userId: "owner", status: "completed" }));
    await svc.delete("b-elev-delete", undefined);
    // Row should be gone from the mock repo
    const after = await repo.findById("b-elev-delete");
    expect(after).toBeNull();
  });

  it("delete still blocked by FK when target benchmark is the canonical benchmark of a baseline", async () => {
    repo.setup(makeBenchmarkRow({ id: "b-elev-baseline", userId: "owner", status: "completed" }));
    // Simulate the Prisma onDelete: Restrict FK violation (P2003) that the real
    // repo.delete would raise when a Baseline references this benchmark.
    const fkErr = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed on the field: `baselines_benchmark_id_fkey`",
      { code: "P2003", clientVersion: "x" },
    );
    repo.delete.mockRejectedValueOnce(fkErr);

    // Even with admin elevation (userId=undefined), Baseline.benchmark
    // onDelete:Restrict surfaces as a Prisma P2003 error (FK violation) — the
    // service must not swallow it.
    await expect(svc.delete("b-elev-baseline", undefined)).rejects.toThrow();
    // Row is still in the mock repo (delete was rejected)
    const stillThere = await repo.findById("b-elev-baseline");
    expect(stillThere).not.toBeNull();
  });
});

describe("BenchmarkService.create — scenario validation", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("rejects (scenario='capacity', tool='vegeta') — vegeta does not serve capacity", async () => {
    // Override the byTool stub for this test to return a vegeta-shaped
    // adapter whose `scenarios` does NOT include 'capacity'. The service's
    // upfront scenario-tool compatibility guard fires before any zod parse.
    const adapters = await import("@modeldoctor/tool-adapters");
    const orig = adapters.byTool;
    (adapters as { byTool: typeof orig }).byTool = (() => ({
      name: "vegeta",
      scenarios: ["gateway"],
      paramsSchema: { parse: (x: unknown) => x },
      reportSchema: { parse: (x: unknown) => x },
      paramDefaults: {},
      buildCommand: () => ({ argv: [], env: {}, secretEnv: {}, outputFiles: {} }),
      parseProgress: () => null,
      parseFinalReport: () => ({ tool: "vegeta" as const, data: {} }),
      getMaxDurationSeconds: () => 1800,
    })) as unknown as typeof orig;
    try {
      await expect(
        svc.create("u1", {
          scenario: "capacity",
          tool: "vegeta",
          connectionId: "c1",
          name: "should-fail",
          params: {},
        }),
      ).rejects.toThrow(/scenario .* does not support tool/);
      expect(repo.create).not.toHaveBeenCalled();
    } finally {
      (adapters as { byTool: typeof orig }).byTool = orig;
    }
  });

  it("rejects guidellm with rateType=sweep under inference scenario", async () => {
    // Restore the real guidellm adapter + real applyScenarioConstraints for
    // this test so the actual zod merging logic narrows rateType.
    const adapters = (await import("@modeldoctor/tool-adapters")) as unknown as {
      byTool: (t: string) => unknown;
      guidellmAdapter: unknown;
      applyScenarioConstraints: (...args: unknown[]) => unknown;
      __realApplyScenarioConstraints: (...args: unknown[]) => unknown;
    };
    const origByTool = adapters.byTool;
    const origApply = adapters.applyScenarioConstraints;
    adapters.byTool = (tool: string) => {
      if (tool === "guidellm") return adapters.guidellmAdapter;
      throw new Error(`unexpected tool ${tool} in test`);
    };
    adapters.applyScenarioConstraints = adapters.__realApplyScenarioConstraints;
    try {
      await expect(
        svc.create("u1", {
          scenario: "inference",
          tool: "guidellm",
          connectionId: "c1",
          name: "no-sweep-here",
          params: {
            profile: "throughput",
            apiType: "chat",
            datasetName: "random",
            datasetInputTokens: 256,
            datasetOutputTokens: 64,
            // 'sweep' is allowed by the base schema but EXCLUDED by the
            // inference-scenario rateType narrowing.
            rateType: "sweep",
          },
        }),
      ).rejects.toThrow(/rateType/i);
      expect(repo.create).not.toHaveBeenCalled();
    } finally {
      adapters.byTool = origByTool;
      adapters.applyScenarioConstraints = origApply;
    }
  });

  it("rejects guidellm without rateType=sweep under capacity scenario", async () => {
    // Real guidellm adapter — capacity narrows rateType to z.literal('sweep').
    const adapters = (await import("@modeldoctor/tool-adapters")) as unknown as {
      byTool: (t: string) => unknown;
      guidellmAdapter: unknown;
      applyScenarioConstraints: (...args: unknown[]) => unknown;
      __realApplyScenarioConstraints: (...args: unknown[]) => unknown;
    };
    const origByTool = adapters.byTool;
    const origApply = adapters.applyScenarioConstraints;
    adapters.byTool = (tool: string) => {
      if (tool === "guidellm") return adapters.guidellmAdapter;
      throw new Error(`unexpected tool ${tool} in test`);
    };
    adapters.applyScenarioConstraints = adapters.__realApplyScenarioConstraints;
    try {
      await expect(
        svc.create("u1", {
          scenario: "capacity",
          tool: "guidellm",
          connectionId: "c1",
          name: "must-be-sweep",
          params: {
            profile: "throughput",
            apiType: "chat",
            // sharegpt avoids the cross-field requirement that random imposes
            // (datasetInputTokens / datasetOutputTokens) — keeps the assertion
            // focused on the rateType narrowing, not unrelated zod issues.
            datasetName: "sharegpt",
            // 'constant' is in the base enum but rejected by the capacity
            // scenario overlay (which forces rateType = literal 'sweep').
            rateType: "constant",
          },
        }),
      ).rejects.toThrow(/rateType/i);
      expect(repo.create).not.toHaveBeenCalled();
    } finally {
      adapters.byTool = origByTool;
      adapters.applyScenarioConstraints = origApply;
    }
  });
});

describe("BenchmarkService.create — FK reference validation", () => {
  // These tests guard against a P2003 FK-violation from Prisma that would
  // otherwise surface as HTTP 500. Each reference (templateId,
  // parentBenchmarkId, baselineId) routes through a single
  // assertReferenceExists helper; we cover all three so the helper's branches
  // stay green and the error codes don't drift.
  let repo: MockRepo;
  let templateRepo: MockTemplateRepo;
  let baselineSvc: MockBaselineService;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    templateRepo = new MockTemplateRepo();
    baselineSvc = new MockBaselineService();
    svc = build(repo, undefined, templateRepo, baselineSvc);
    vi.clearAllMocks();
  });

  // Helper: capture the BadRequestException, return its response body so
  // tests can assert on the `code` field (the public contract surfaced via
  // getResponse()) instead of relying on Nest's private `response` field.
  async function captureCreateError(req: Parameters<BenchmarkService["create"]>[1]) {
    try {
      await svc.create("u1", req);
    } catch (e) {
      return e as BadRequestException;
    }
    throw new Error("expected create() to throw, but it resolved");
  }

  it("throws BadRequestException with BENCHMARK_TEMPLATE_NOT_FOUND when templateId is unknown", async () => {
    // Empty templateRepo → findByIdOrNull returns null → assertReferenceExists
    // throws before repo.create is reached.
    const err = await captureCreateError({
      tool: "guidellm",
      scenario: "inference",
      connectionId: "c1",
      name: "with-bogus-template",
      params: {},
      templateId: "tpl-nonexistent",
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: "BENCHMARK_TEMPLATE_NOT_FOUND" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("throws BadRequestException with BENCHMARK_PARENT_NOT_FOUND when parentBenchmarkId is unknown", async () => {
    // MockRepo.existsById returns false for anything not in `rows`.
    const err = await captureCreateError({
      tool: "guidellm",
      scenario: "inference",
      connectionId: "c1",
      name: "with-bogus-parent",
      params: {},
      parentBenchmarkId: "bm-nonexistent",
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: "BENCHMARK_PARENT_NOT_FOUND" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("throws BadRequestException with BENCHMARK_BASELINE_NOT_FOUND when baselineId is unknown", async () => {
    // MockBaselineService starts empty → existsById returns false.
    const err = await captureCreateError({
      tool: "guidellm",
      scenario: "inference",
      connectionId: "c1",
      name: "with-bogus-baseline",
      params: {},
      baselineId: "bl-nonexistent",
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: "BENCHMARK_BASELINE_NOT_FOUND" });
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ── getByConnectionReports ───────────────────────────────────────────────────

function makeMockRepoLocal() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countActiveByName: vi.fn(),
    existsById: vi.fn(),
  };
}
function makeMockPrismaLocal() {
  return {
    connection: { findMany: vi.fn() },
  } as unknown as { connection: { findMany: ReturnType<typeof vi.fn> } };
}

describe("BenchmarkService.getByConnectionReports", () => {
  function makeRow(
    overrides: Partial<{
      id: string;
      connectionId: string;
      connection: { id: string; name: string; model: string; baseUrl: string } | null;
      tool: "guidellm" | "vegeta";
      status: string;
      summaryMetrics: unknown;
      createdAt: Date;
      name: string;
    }> = {},
  ) {
    return {
      id: overrides.id ?? "b1",
      userId: "u_1",
      connectionId: overrides.connectionId ?? (overrides.connection === null ? null : "c_1"),
      connection:
        overrides.connection === null
          ? null
          : (overrides.connection ?? {
              id: "c_1",
              name: "conn-1",
              model: "m1",
              baseUrl: "http://x/1",
            }),
      scenario: "inference",
      tool: overrides.tool ?? "guidellm",
      toolVersion: null,
      name: overrides.name ?? "run",
      description: null,
      status: overrides.status ?? "completed",
      statusMessage: null,
      progress: 1,
      driverHandle: null,
      params: {},
      rawOutput: null,
      summaryMetrics:
        overrides.summaryMetrics !== undefined
          ? overrides.summaryMetrics
          : {
              tool: "guidellm",
              data: { e2eLatency: { p95: 100 } },
            },
      serverMetrics: null,
      templateId: null,
      parentBenchmarkId: null,
      baselineId: null,
      logs: null,
      createdAt: overrides.createdAt ?? new Date("2026-05-01T00:00:00Z"),
      startedAt: null,
      completedAt: null,
      baselineFor: null,
    };
  }

  function makeSvc(
    repo: ReturnType<typeof makeMockRepoLocal>,
    prisma: ReturnType<typeof makeMockPrismaLocal>,
  ) {
    return new BenchmarkService(
      repo as never,
      {} as never, // runner — not used by getByConnectionReports
      mockConfig() as unknown as ConfigService<typeof ENV_DEFAULTS, true>,
      {} as never, // connections — not used
      {} as never, // templates — not used
      {} as never, // baselines — not used
      prisma as never,
      { emit: vi.fn() } as never, // notify — not used
    );
  }

  it("groups runs by connection and returns one entry per group", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({
          id: "b1",
          connectionId: "c_a",
          connection: { id: "c_a", name: "A", model: "ma", baseUrl: "http://a" },
        }),
        makeRow({
          id: "b2",
          connectionId: "c_a",
          connection: { id: "c_a", name: "A", model: "ma", baseUrl: "http://a" },
        }),
        makeRow({
          id: "b3",
          connectionId: "c_b",
          connection: { id: "c_b", name: "B", model: "mb", baseUrl: "http://b" },
        }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([
      { id: "c_a", category: "chat" },
      { id: "c_b", category: "embeddings" },
    ]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");

    expect(out.range).toBe("30d");
    expect(out.items).toHaveLength(2);
    const byId = Object.fromEntries(out.items.map((i) => [i.connection.id, i]));
    expect(byId.c_a.totalRuns).toBe(2);
    expect(byId.c_b.totalRuns).toBe(1);
  });

  it("sorts items by totalRuns descending", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({
          id: "b1",
          connectionId: "c_a",
          connection: { id: "c_a", name: "A", model: "ma", baseUrl: "http://a" },
        }),
        makeRow({
          id: "b2",
          connectionId: "c_b",
          connection: { id: "c_b", name: "B", model: "mb", baseUrl: "http://b" },
        }),
        makeRow({
          id: "b3",
          connectionId: "c_b",
          connection: { id: "c_b", name: "B", model: "mb", baseUrl: "http://b" },
        }),
        makeRow({
          id: "b4",
          connectionId: "c_b",
          connection: { id: "c_b", name: "B", model: "mb", baseUrl: "http://b" },
        }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([
      { id: "c_a", category: "chat" },
      { id: "c_b", category: "chat" },
    ]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items.map((i) => i.connection.id)).toEqual(["c_b", "c_a"]);
  });

  it("computes successRate from terminal runs only", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", status: "completed" }),
        makeRow({ id: "b2", status: "completed" }),
        makeRow({ id: "b3", status: "completed" }),
        makeRow({ id: "b4", status: "failed" }),
        makeRow({ id: "b5", status: "failed" }),
        makeRow({ id: "b6", status: "running" }), // ignored — not terminal
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([{ id: "c_1", category: "chat" }]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].successRate).toBe(60); // 3 / (3+2) = 60%
  });

  it("p95Latency picks earliest + latest completed run with usable metrics", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({
          id: "old",
          createdAt: new Date("2026-04-20"),
          summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 100 } } },
        }),
        makeRow({
          id: "mid",
          createdAt: new Date("2026-04-25"),
          summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 150 } } },
        }),
        makeRow({
          id: "new",
          createdAt: new Date("2026-05-01"),
          summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 250 } } },
        }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([{ id: "c_1", category: "chat" }]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].p95Latency).toEqual({ first: 100, last: 250 });
  });

  it("drops rows whose connection is null (deleted connection)", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({
          id: "b1",
          connectionId: "c_a",
          connection: { id: "c_a", name: "A", model: "ma", baseUrl: "http://a" },
        }),
        makeRow({ id: "b2", connection: null }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([{ id: "c_a", category: "chat" }]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].connection.id).toBe("c_a");
  });

  it("returns p95Latency=null when no completed run carries usable metrics", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", status: "failed", summaryMetrics: null }),
        makeRow({ id: "b2", status: "running", summaryMetrics: null }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([{ id: "c_1", category: "chat" }]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].p95Latency).toBeNull();
  });

  it("range '7d' lower-bounds repo.list via createdAfter", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({ items: [], nextCursor: null });
    const prisma = makeMockPrismaLocal();
    const svc = makeSvc(repo, prisma);

    await svc.getByConnectionReports("u_1", "7d");
    const call = repo.list.mock.calls[0][0];
    expect(call.userId).toBe("u_1");
    expect(call.createdAfter).toBeDefined();
    const lowerBound = new Date(call.createdAfter as string);
    const expected = Date.now() - 7 * 86400_000;
    // Allow ±2s skew for the time it takes the test to run.
    expect(Math.abs(lowerBound.getTime() - expected)).toBeLessThan(2000);
  });

  it("does not call connection.findMany when no rows have a connection", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        // All rows orphaned — every connection deleted.
        makeRow({ id: "b1", connection: null }),
        makeRow({ id: "b2", connection: null }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items).toEqual([]);
    expect(prisma.connection.findMany).not.toHaveBeenCalled();
  });

  it("emits statusCounts breakdown (completed / failed / canceled / inProgress)", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", status: "completed" }),
        makeRow({ id: "b2", status: "completed" }),
        makeRow({ id: "b3", status: "completed" }),
        makeRow({ id: "b4", status: "failed" }),
        makeRow({ id: "b5", status: "canceled" }),
        makeRow({ id: "b6", status: "running" }),
        makeRow({ id: "b7", status: "submitted" }),
        makeRow({ id: "b8", status: "pending" }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([{ id: "c_1", category: "chat" }]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].statusCounts).toEqual({
      completed: 3,
      failed: 1,
      canceled: 1,
      inProgress: 3,
    });
  });
});
