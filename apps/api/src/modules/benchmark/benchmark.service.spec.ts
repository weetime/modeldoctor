import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { type Benchmark as PrismaBenchmark, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as hmacToken from "../../common/hmac/hmac-token.js";
import type { ConnectionService } from "../connection/connection.service.js";
import { BenchmarkRepository, type BenchmarkWithRelations } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";

// Stub adapter registry to avoid pulling in the real (stubbed) adapters'
// buildCommand / paramsSchema implementations.
vi.mock("@modeldoctor/tool-adapters", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    byTool: () => ({
      name: "guidellm",
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
  BENCHMARK_DRIVER: "subprocess",
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

function build(repo: MockRepo, configOverrides?: Record<string, unknown>) {
  return new BenchmarkService(
    repo as unknown as BenchmarkRepository,
    mockDriver,
    mockConfig(configOverrides) as unknown as ConfigService<typeof ENV_DEFAULTS, true>,
    mockConnections,
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
    repo.setup(
      makeBenchmarkRow({ id: "b1", status: "running", driverHandle: "subprocess:1234" }),
    );
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

  it("deletes a terminal benchmark", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "completed" }));
    await svc.delete("b1", "u1");
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });

  it("throws ConflictException when benchmark is not terminal", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "running" }));
    await expect(svc.delete("b1", "u1")).rejects.toThrow(ConflictException);
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
    repo.setup(
      makeBenchmarkRow({ id: "b1", userId: "u1", connectionId: "c1", status: "pending" }),
    );
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
    repo.setup(
      makeBenchmarkRow({ id: "b1", status: "running", driverHandle: "subprocess:1234" }),
    );
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
