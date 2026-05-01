import type { CreateBenchmarkRequest } from "@modeldoctor/contracts";
import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../common/crypto/aes-gcm.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BenchmarkService } from "./benchmark.service.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";

const KEY = Buffer.alloc(32, 7);
const SECRET = Buffer.from("y".repeat(48), "utf8");

function buildConfig(over: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        BENCHMARK_API_KEY_ENCRYPTION_KEY: KEY.toString("base64"),
        BENCHMARK_CALLBACK_SECRET: SECRET.toString("utf8"),
        BENCHMARK_CALLBACK_URL: "http://localhost:3001",
        BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 1800,
        BENCHMARK_VALIDATE_BACKEND: true,
        BENCHMARK_DEFAULT_MAX_CONCURRENCY: 100,
        BENCHMARK_DRIVER: "subprocess",
        ...over,
      };
      return map[key];
    },
  } as unknown as ConfigService;
}

/**
 * PrismaStub: only run.* is used directly (for findFirst + count).
 * RunRepository is mocked separately.
 */
interface PrismaStub {
  run: {
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
}
function buildPrisma(): PrismaStub {
  return {
    run: {
      findFirst: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

interface RunsStub {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}
function buildRuns(): RunsStub {
  return {
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
}

function buildDriver(): BenchmarkExecutionDriver & {
  start: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(async () => ({ handle: "subprocess:1234" })),
    cancel: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
}

const user: JwtPayload = { sub: "user-1", roles: [] } as unknown as JwtPayload;

const validRequest: CreateBenchmarkRequest = {
  name: "first run",
  profile: "throughput",
  apiType: "chat",
  apiBaseUrl: "https://api.example.com",
  apiKey: "sk-12345",
  model: "llama-3-70b",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  requestRate: 0,
  totalRequests: 1000,
};

/** Build a canonical Run row that mirrors what RunRepository.create/update returns. */
function makeRunRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ckxxx1",
    userId: user.sub,
    kind: "benchmark",
    tool: "guidellm",
    driverKind: "local",
    mode: "throughput",
    status: "pending",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    summaryMetrics: null,
    rawOutput: null,
    logs: null,
    name: "first run",
    description: null,
    apiKeyCipher: encrypt("sk-12345", KEY),
    scenario: {
      apiType: "chat",
      apiBaseUrl: "https://api.example.com",
      model: "llama-3-70b",
      dataset: { name: "random", inputTokens: 1024, outputTokens: 128, seed: null },
      requestRate: 0,
      totalRequests: 1000,
    },
    params: { profile: "throughput" },
    connectionId: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    createdAt: new Date("2026-04-26T00:00:00Z"),
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

describe("BenchmarkService.create + start", () => {
  let prisma: PrismaStub;
  let runs: RunsStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    runs = buildRuns();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never, runs as never);

    // count returns 0 (no duplicates)
    prisma.run.count.mockResolvedValue(0);

    // runs.create returns a pending row
    runs.create.mockImplementation(async (input: Record<string, unknown>) =>
      makeRunRow({ name: input.name as string }),
    );

    // runs.findById returns the row with apiKeyCipher set
    runs.findById.mockImplementation(async (id: string) => makeRunRow({ id }));

    // runs.update returns an updated row (simulate submitted after start)
    runs.update.mockImplementation(async (id: string, data: Record<string, unknown>) =>
      makeRunRow({ id, status: "submitted", driverHandle: "subprocess:1234", ...data }),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("encrypts the apiKey, persists pending, calls driver.start, returns submitted dto", async () => {
    const result = await svc.create(validRequest, user);

    // runs.create was called with ciphertext, not plaintext.
    const createCall = runs.create.mock.calls[0][0] as Record<string, unknown>;
    expect(createCall.apiKeyCipher).not.toBe("sk-12345");
    expect(createCall.apiKeyCipher).toMatch(/^v1:/);
    // Initial status is set to pending via create (no explicit status field — RunRepository sets via Prisma default).
    expect(createCall.kind).toBe("benchmark");

    // Driver was called with decrypted ctx.
    const driverCall = driver.start.mock.calls[0][0] as Record<string, unknown>;
    expect(driverCall.apiKey).toBe("sk-12345");
    expect(driverCall.benchmarkId).toBe("ckxxx1");
    expect(driverCall.callbackUrl).toBe("http://localhost:3001");
    expect(driverCall.callbackToken as string).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(driverCall.maxDurationSeconds).toBe(1800);

    // runs.update was called with submitted + handle.
    const updateCall = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(updateCall[1].status).toBe("submitted");
    expect(updateCall[1].driverHandle).toBe("subprocess:1234");

    // Returned DTO does NOT carry apiKeyCipher.
    expect(result).not.toHaveProperty("apiKeyCipher");
    expect(result.state).toBe("submitted");
  });

  it("rejects datasetName=sharegpt with BENCHMARK_DATASET_UNSUPPORTED", async () => {
    await expect(
      svc.create({ ...validRequest, datasetName: "sharegpt" }, user),
    ).rejects.toMatchObject({
      response: { code: "BENCHMARK_DATASET_UNSUPPORTED" },
      status: 400,
    });
    expect(runs.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate active name with BENCHMARK_NAME_IN_USE", async () => {
    prisma.run.count.mockResolvedValue(1);
    await expect(svc.create(validRequest, user)).rejects.toMatchObject({
      response: { code: "BENCHMARK_NAME_IN_USE" },
      status: 409,
    });
    expect(runs.create).not.toHaveBeenCalled();
  });

  it("marks the row failed when driver.start throws", async () => {
    driver.start.mockRejectedValue(new Error("rbac denied"));
    await expect(svc.create(validRequest, user)).rejects.toThrow(/rbac denied/);
    const updateCall = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(updateCall[1].status).toBe("failed");
    expect(updateCall[1].statusMessage).toMatch(/rbac denied/);
  });
});

describe("BenchmarkService.list + detail", () => {
  let prisma: PrismaStub;
  let runs: RunsStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    runs = buildRuns();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never, runs as never);
  });

  function row(over: Partial<{ id: string; name: string; userId: string }> = {}) {
    return makeRunRow({
      id: over.id ?? "r1",
      userId: over.userId ?? user.sub,
      name: over.name ?? "n",
      status: "running",
      progress: 0.4,
      driverHandle: "subprocess:1",
      startedAt: new Date("2026-04-26T00:00:01Z"),
    });
  }

  it("scopes non-admin queries to the caller's userId", async () => {
    prisma.run.findMany.mockResolvedValue([row({ id: "a" })]);
    await svc.list({ limit: 20 }, user);
    const args = prisma.run.findMany.mock.calls[0][0] as Record<string, unknown>;
    const where = args.where as Record<string, unknown>;
    expect(where.userId).toBe(user.sub);
  });

  it("admin queries are not scoped by userId", async () => {
    prisma.run.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20 }, { ...user, roles: ["admin"] });
    const args = prisma.run.findMany.mock.calls[0][0] as Record<string, unknown>;
    const where = args.where as Record<string, unknown>;
    expect(where.userId).toBeUndefined();
  });

  it("returns peek+1 next-cursor when there are more rows", async () => {
    const rows = Array.from({ length: 21 }, (_v, i) => row({ id: `r${i}` }));
    prisma.run.findMany.mockResolvedValue(rows);
    const out = await svc.list({ limit: 20 }, user);
    expect(out.items).toHaveLength(20);
    expect(out.nextCursor).toBe("r19");
  });

  it("nextCursor is null when at the end", async () => {
    prisma.run.findMany.mockResolvedValue([row({ id: "r0" })]);
    const out = await svc.list({ limit: 20 }, user);
    expect(out.nextCursor).toBeNull();
  });

  it("applies state + profile filters when provided", async () => {
    prisma.run.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20, state: "running", profile: "latency" }, user);
    const args = prisma.run.findMany.mock.calls[0][0] as Record<string, unknown>;
    const where = args.where as Record<string, unknown>;
    expect(where.status).toBe("running");
    expect(where.params).toEqual({ path: ["profile"], equals: "latency" });
  });

  it("applies search as case-insensitive name contains", async () => {
    prisma.run.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20, search: "Foo" }, user);
    const args = prisma.run.findMany.mock.calls[0][0] as Record<string, unknown>;
    const where = args.where as Record<string, unknown>;
    expect(where.name).toEqual({ contains: "Foo", mode: "insensitive" });
  });

  it("detail returns the full row sans apiKeyCipher", async () => {
    prisma.run.findFirst.mockResolvedValue(row({ id: "x" }));
    const dto = await svc.detail("x", user);
    expect(dto.id).toBe("x");
    expect(dto).not.toHaveProperty("apiKeyCipher");
  });

  it("detail returns 404 for non-existent / non-owned rows", async () => {
    prisma.run.findFirst.mockResolvedValue(null);
    await expect(svc.detail("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});

describe("BenchmarkService.cancel", () => {
  let prisma: PrismaStub;
  let runs: RunsStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    runs = buildRuns();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never, runs as never);
    runs.update.mockImplementation(async (id: string, data: Record<string, unknown>) =>
      makeRunRow({ id, status: data.status ?? "running", ...data }),
    );
  });

  it("cancel of pending: marks canceled without calling driver", async () => {
    prisma.run.findFirst.mockResolvedValue(
      makeRunRow({ id: "r1", userId: user.sub, status: "pending", driverHandle: null }),
    );
    await svc.cancel("r1", user);
    expect(driver.cancel).not.toHaveBeenCalled();
    const upd = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(upd[1].status).toBe("canceled");
  });

  it("cancel of running: calls driver.cancel and marks canceled", async () => {
    prisma.run.findFirst.mockResolvedValue(
      makeRunRow({ id: "r1", userId: user.sub, status: "running", driverHandle: "subprocess:1" }),
    );
    await svc.cancel("r1", user);
    expect(driver.cancel).toHaveBeenCalledWith("subprocess:1");
    const upd = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(upd[1].status).toBe("canceled");
  });

  it("cancel still marks canceled if driver.cancel throws (best effort)", async () => {
    prisma.run.findFirst.mockResolvedValue(
      makeRunRow({ id: "r1", userId: user.sub, status: "running", driverHandle: "subprocess:1" }),
    );
    driver.cancel.mockRejectedValue(new Error("k8s glitch"));
    await svc.cancel("r1", user);
    const upd = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(upd[1].status).toBe("canceled");
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "cancel of terminal state %s rejects with BENCHMARK_ALREADY_TERMINAL",
    async (state) => {
      prisma.run.findFirst.mockResolvedValue(
        makeRunRow({ id: "r1", userId: user.sub, status: state, driverHandle: null }),
      );
      await expect(svc.cancel("r1", user)).rejects.toMatchObject({
        response: { code: "BENCHMARK_ALREADY_TERMINAL" },
        status: 400,
      });
    },
  );

  it("cancel returns 404 for missing / non-owned", async () => {
    prisma.run.findFirst.mockResolvedValue(null);
    await expect(svc.cancel("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});

describe("BenchmarkService.delete", () => {
  let prisma: PrismaStub;
  let runs: RunsStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    runs = buildRuns();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never, runs as never);
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "deletes terminal-state row %s",
    async (state) => {
      prisma.run.findFirst.mockResolvedValue(
        makeRunRow({ id: "r1", userId: user.sub, status: state }),
      );
      runs.delete.mockResolvedValue(makeRunRow({ id: "r1" }));
      await svc.delete("r1", user);
      expect(runs.delete).toHaveBeenCalledWith("r1");
    },
  );

  it.each(["pending", "submitted", "running"] as const)(
    "rejects delete of non-terminal state %s with BENCHMARK_NOT_TERMINAL",
    async (state) => {
      prisma.run.findFirst.mockResolvedValue(
        makeRunRow({ id: "r1", userId: user.sub, status: state }),
      );
      await expect(svc.delete("r1", user)).rejects.toMatchObject({
        response: { code: "BENCHMARK_NOT_TERMINAL" },
        status: 409,
      });
      expect(runs.delete).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for missing / non-owned", async () => {
    prisma.run.findFirst.mockResolvedValue(null);
    await expect(svc.delete("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});

describe("BenchmarkService.handleStateCallback", () => {
  let prisma: PrismaStub;
  let runs: RunsStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    runs = buildRuns();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never, runs as never);
  });

  it("missing row: returns silently without UPDATE", async () => {
    runs.findById.mockResolvedValue(null);
    await svc.handleStateCallback("missing", { state: "running" });
    expect(runs.update).not.toHaveBeenCalled();
  });

  it("submitted → running: UPDATE status and progress", async () => {
    runs.findById.mockResolvedValue(makeRunRow({ id: "r1", status: "submitted" }));
    runs.update.mockResolvedValue(makeRunRow({ id: "r1", status: "running" }));
    await svc.handleStateCallback("r1", { state: "running", progress: 0.1 });
    expect(runs.update).toHaveBeenCalledWith("r1", {
      status: "running",
      progress: 0.1,
      statusMessage: null,
    });
  });

  it("running → running (duplicate): no UPDATE", async () => {
    runs.findById.mockResolvedValue(makeRunRow({ id: "r1", status: "running" }));
    await svc.handleStateCallback("r1", { state: "running" });
    expect(runs.update).not.toHaveBeenCalled();
  });

  it("running → completed: UPDATE with completedAt", async () => {
    runs.findById.mockResolvedValue(makeRunRow({ id: "r1", status: "running" }));
    runs.update.mockResolvedValue(makeRunRow({ id: "r1", status: "completed" }));
    await svc.handleStateCallback("r1", { state: "completed", progress: 1 });
    const args = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[1].status).toBe("completed");
    expect(args[1].completedAt).toBeInstanceOf(Date);
    expect(args[1].progress).toBe(1);
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "%s → running: silent warn, no UPDATE (forward-only)",
    async (state) => {
      runs.findById.mockResolvedValue(makeRunRow({ id: "r1", status: state }));
      await svc.handleStateCallback("r1", { state: "running" });
      expect(runs.update).not.toHaveBeenCalled();
    },
  );

  it("running → failed: UPDATE with statusMessage truncated to 2048 chars", async () => {
    runs.findById.mockResolvedValue(makeRunRow({ id: "r1", status: "running" }));
    runs.update.mockResolvedValue(makeRunRow({ id: "r1", status: "failed" }));
    const huge = "x".repeat(5000);
    await svc.handleStateCallback("r1", { state: "failed", stateMessage: huge });
    const args = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[1].status).toBe("failed");
    expect((args[1].statusMessage as string).length).toBeLessThanOrEqual(2048);
  });
});

describe("BenchmarkService.handleMetricsCallback", () => {
  let prisma: PrismaStub;
  let runs: RunsStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  const summary = {
    ttft: { mean: 1, p50: 1, p95: 2, p99: 3 },
    itl: { mean: 1, p50: 1, p95: 2, p99: 3 },
    e2eLatency: { mean: 1, p50: 1, p95: 2, p99: 3 },
    requestsPerSecond: { mean: 10 },
    outputTokensPerSecond: { mean: 100 },
    inputTokensPerSecond: { mean: 50 },
    totalTokensPerSecond: { mean: 150 },
    concurrency: { mean: 1, max: 1 },
    requests: { total: 100, success: 99, error: 1, incomplete: 0 },
  };

  beforeEach(() => {
    prisma = buildPrisma();
    runs = buildRuns();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never, runs as never);
  });

  it("writes metrics regardless of state (forensic value)", async () => {
    runs.findById.mockResolvedValue(makeRunRow({ id: "r1", status: "failed" }));
    runs.update.mockResolvedValue(makeRunRow({ id: "r1" }));
    await svc.handleMetricsCallback("r1", {
      metricsSummary: summary,
      rawMetrics: { foo: 1 },
      logs: "tail",
    });
    const args = runs.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[1].summaryMetrics).toEqual(summary);
    expect(args[1].rawOutput).toEqual({ foo: 1 });
    expect(args[1].logs).toBe("tail");
    // status was NOT touched
    expect(args[1].status).toBeUndefined();
  });

  it("missing row: silent ok", async () => {
    runs.findById.mockResolvedValue(null);
    await svc.handleMetricsCallback("missing", {
      metricsSummary: summary,
      rawMetrics: null,
    });
    expect(runs.update).not.toHaveBeenCalled();
  });
});
