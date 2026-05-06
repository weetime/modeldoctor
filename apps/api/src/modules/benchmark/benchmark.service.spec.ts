import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Prisma, type Benchmark as PrismaBenchmark } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as hmacToken from "../../common/hmac/hmac-token.js";
import type { BaselineService } from "../baseline/baseline.service.js";
import { BenchmarkTemplateRepository } from "../benchmark-template/benchmark-template.repository.js";
import type { ConnectionService } from "../connection/connection.service.js";
import { BenchmarkRepository, type BenchmarkWithRelations } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";

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
    }),
  };
});

const ENV_DEFAULTS: Record<string, unknown> = {
  BENCHMARK_CALLBACK_SECRET: "x".repeat(32),
  BENCHMARK_CALLBACK_URL: "http://api/",
  BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 1800,
  RUNNER_IMAGE_GUIDELLM: "img-guidellm:test",
  RUNNER_IMAGE_VEGETA: "img-vegeta:test",
  RUNNER_IMAGE_GENAI_PERF: "img-genai-perf:test",
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
    connection: { id: "c1", name: "conn" },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    driverKind: "local",
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

const mockDriver: BenchmarkExecutionDriver = {
  start: vi.fn(async () => ({ handle: "subprocess:1234" })),
  cancel: vi.fn(async () => undefined),
  cleanup: vi.fn(async () => undefined),
};

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
    mockDriver,
    mockConfig(configOverrides) as unknown as ConfigService<typeof ENV_DEFAULTS, true>,
    mockConnections,
    (templateRepo ?? new MockTemplateRepo()) as unknown as BenchmarkTemplateRepository,
    (baselineSvc ?? new MockBaselineService()) as unknown as BaselineService,
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
    expect(mockDriver.start).toHaveBeenCalledTimes(1);
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
    expect(mockDriver.cancel).toHaveBeenCalledWith("subprocess:1234");
    expect(dto.status).toBe("canceled");
    expect(dto.completedAt).not.toBeNull();
  });

  it("does NOT call driver.cancel when status is pending", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "pending", driverHandle: null }));
    await svc.cancel("b1", "u1");
    expect(mockDriver.cancel).not.toHaveBeenCalled();
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
    expect(mockDriver.cancel).not.toHaveBeenCalled();
  });

  it("deletes a submitted benchmark and best-effort cancels driver", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "submitted", driverHandle: "k8s:job-1" }));
    await svc.delete("b1", "u1");
    expect(mockDriver.cancel).toHaveBeenCalledWith("k8s:job-1");
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });

  it("deletes a running benchmark even when driver.cancel throws", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "running", driverHandle: "k8s:job-2" }));
    (mockDriver.cancel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("apiserver flake"),
    );
    await svc.delete("b1", "u1");
    expect(mockDriver.cancel).toHaveBeenCalledWith("k8s:job-2");
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });

  it("does not call driver.cancel when driverHandle is null", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "submitted", driverHandle: null }));
    await svc.delete("b1", "u1");
    expect(mockDriver.cancel).not.toHaveBeenCalled();
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
    (mockDriver.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
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
    (mockDriver.cancel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("apiserver flake"),
    );
    await expect(svc.cancel("b1", "u1")).rejects.toThrow(/apiserver flake/);
    const row = await repo.findById("b1");
    expect(row?.status).toBe("running"); // NOT canceled
  });
});

describe("BenchmarkService.start — callback TTL", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    // Config default is 1800; adapter mock returns 1800 by default too.
    // For this describe block we override the adapter to return 7200 to confirm
    // the TTL is sourced from the adapter, not from the config default.
    svc = build(repo, { BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 1800 });
    vi.clearAllMocks();
  });

  it("signs token with adapter.getMaxDurationSeconds(params), not config default", async () => {
    // Override the byTool stub so getMaxDurationSeconds returns 7200
    // (simulating a 2h guidellm soak run).
    const adapters = await import("@modeldoctor/tool-adapters");
    const orig = adapters.byTool;
    (adapters as { byTool: typeof orig }).byTool = (() => ({
      name: "guidellm",
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
      parseFinalReport: () => ({ tool: "guidellm" as const, data: {} }),
      getMaxDurationSeconds: () => 7200,
    })) as unknown as typeof orig;

    // Spy on signCallbackToken to capture the ttlSeconds argument.
    const signSpy = vi.spyOn(hmacToken, "signCallbackToken");

    try {
      repo.setup(
        makeBenchmarkRow({ id: "b1", userId: "u1", connectionId: "c1", status: "pending" }),
      );
      await svc.start("b1");

      // adapter returns 7200; CALLBACK_TTL_SLACK_SECONDS = 15 * 60 = 900.
      // Expected ttl = 7200 + 900 = 8100.
      expect(signSpy).toHaveBeenCalledWith("b1", expect.any(Buffer), 8100);
    } finally {
      signSpy.mockRestore();
      (adapters as { byTool: typeof orig }).byTool = orig;
    }
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
