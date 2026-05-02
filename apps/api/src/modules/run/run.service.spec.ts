import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Run as PrismaRun } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../connection/connection.service.js";
import type { RunExecutionDriver } from "./drivers/execution-driver.interface.js";
import type { RunRepository, RunWithRelations } from "./run.repository.js";
import { RunService } from "./run.service.js";

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

function makeRunRow(over: Partial<RunWithRelations> = {}): RunWithRelations {
  const base: Partial<RunWithRelations> = {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "conn" },
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
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
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: new Date("2026-05-02T00:00:00Z"),
    startedAt: null,
    completedAt: null,
  };
  return { ...base, ...over } as RunWithRelations;
}

class MockRepo {
  rows = new Map<string, RunWithRelations>();
  countResult = 0;
  setup(row: RunWithRelations) {
    this.rows.set(row.id, row);
  }
  findById = vi.fn(async (id: string) => this.rows.get(id) ?? null);
  list = vi.fn(async () => ({ items: [...this.rows.values()], nextCursor: null }));
  create = vi.fn(async (input: { userId: string; name: string; tool: string }) => {
    const row = makeRunRow({
      id: `gen-${this.rows.size + 1}`,
      userId: input.userId,
      name: input.name,
      tool: input.tool as RunWithRelations["tool"],
    });
    this.rows.set(row.id, row);
    return row as unknown as PrismaRun;
  });
  update = vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const cur = this.rows.get(id) as RunWithRelations | undefined;
    if (!cur) throw new Error("not found");
    const next = { ...cur, ...patch } as RunWithRelations;
    this.rows.set(id, next);
    return next as unknown as PrismaRun;
  });
  delete = vi.fn(async (id: string) => {
    const cur = this.rows.get(id);
    this.rows.delete(id);
    return cur as unknown as PrismaRun;
  });
  countActiveByName = vi.fn(async (_u: string, _n: string) => this.countResult);
}

const mockDriver: RunExecutionDriver = {
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
    category: "text" as const,
  })),
} as unknown as ConnectionService;

function build(repo: MockRepo, configOverrides?: Record<string, unknown>) {
  return new RunService(
    repo as unknown as RunRepository,
    mockDriver,
    mockConfig(configOverrides) as unknown as ConfigService<typeof ENV_DEFAULTS, true>,
    mockConnections,
  );
}

describe("RunService.findById / list", () => {
  let repo: MockRepo;
  let svc: RunService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("findById returns ISO-stringified row", async () => {
    repo.setup(makeRunRow({ id: "r1" }));
    const dto = await svc.findById("r1");
    expect(typeof dto?.createdAt).toBe("string");
    expect(dto?.id).toBe("r1");
  });

  it("findByIdOrFail throws when missing", async () => {
    await expect(svc.findByIdOrFail("nope")).rejects.toThrow(NotFoundException);
  });

  it("findByIdOrFail throws when user mismatch", async () => {
    repo.setup(makeRunRow({ id: "r1", userId: "u1" }));
    await expect(svc.findByIdOrFail("r1", "other")).rejects.toThrow(NotFoundException);
  });
});

describe("RunService.create", () => {
  let repo: MockRepo;
  let svc: RunService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("creates → starts and returns the started Run", async () => {
    const dto = await svc.create("u1", {
      tool: "guidellm",
      kind: "benchmark",
      connectionId: "c1",
      name: "smoke",
      params: {},
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(mockDriver.start).toHaveBeenCalledTimes(1);
    expect(dto.status).toBe("submitted");
    expect(dto.driverHandle).toBe("subprocess:1234");
  });

  it("throws ConflictException when an active run with the same name exists", async () => {
    repo.countResult = 1;
    await expect(
      svc.create("u1", {
        tool: "guidellm",
        kind: "benchmark",
        connectionId: "c1",
        name: "smoke",
        params: {},
      }),
    ).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("RunService.cancel", () => {
  let repo: MockRepo;
  let svc: RunService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("marks run as canceled and calls driver.cancel when handle exists", async () => {
    repo.setup(makeRunRow({ id: "r1", status: "running", driverHandle: "subprocess:1234" }));
    const dto = await svc.cancel("r1", "u1");
    expect(mockDriver.cancel).toHaveBeenCalledWith("subprocess:1234");
    expect(dto.status).toBe("canceled");
    expect(dto.completedAt).not.toBeNull();
  });

  it("does NOT call driver.cancel when status is pending", async () => {
    repo.setup(makeRunRow({ id: "r1", status: "pending", driverHandle: null }));
    await svc.cancel("r1", "u1");
    expect(mockDriver.cancel).not.toHaveBeenCalled();
  });

  it("throws BadRequestException when run is already terminal", async () => {
    repo.setup(makeRunRow({ id: "r1", status: "completed" }));
    await expect(svc.cancel("r1", "u1")).rejects.toThrow(BadRequestException);
  });
});

describe("RunService.delete", () => {
  let repo: MockRepo;
  let svc: RunService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("deletes a terminal run", async () => {
    repo.setup(makeRunRow({ id: "r1", status: "completed" }));
    await svc.delete("r1", "u1");
    expect(repo.delete).toHaveBeenCalledWith("r1");
  });

  it("throws ConflictException when run is not terminal", async () => {
    repo.setup(makeRunRow({ id: "r1", status: "running" }));
    await expect(svc.delete("r1", "u1")).rejects.toThrow(ConflictException);
  });
});
