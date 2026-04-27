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
        ...over,
      };
      return map[key];
    },
  } as unknown as ConfigService;
}

interface PrismaStub {
  benchmarkRun: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}
function buildPrisma(): PrismaStub {
  return {
    benchmarkRun: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
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
  apiUrl: "https://api.example.com",
  apiKey: "sk-12345",
  model: "llama-3-70b",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  requestRate: 0,
  totalRequests: 1000,
};

describe("BenchmarkService.create + start", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never);
    prisma.benchmarkRun.count.mockResolvedValue(0);
    prisma.benchmarkRun.create.mockImplementation(async ({ data }) => ({
      id: "ckxxx1",
      userId: user.sub,
      ...data,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: null,
      completedAt: null,
      state: "pending",
      stateMessage: null,
      progress: null,
      jobName: null,
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      datasetSeed: null,
    }));
    prisma.benchmarkRun.findUnique.mockImplementation(async ({ where: { id } }) => ({
      id,
      userId: user.sub,
      apiKeyCipher: encrypt("sk-12345", KEY),
      apiUrl: validRequest.apiUrl,
      apiType: "chat",
      model: validRequest.model,
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: "first run",
      description: null,
      state: "pending",
      stateMessage: null,
      progress: null,
      jobName: null,
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: null,
      completedAt: null,
    }));
    prisma.benchmarkRun.update.mockImplementation(async ({ where: { id }, data }) => ({
      id,
      userId: user.sub,
      apiKeyCipher: "<encrypted>",
      apiUrl: validRequest.apiUrl,
      apiType: "chat",
      model: validRequest.model,
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: "first run",
      description: null,
      state: "submitted",
      stateMessage: null,
      progress: null,
      jobName: data.jobName ?? "subprocess:1234",
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: data.startedAt ?? new Date(),
      completedAt: null,
      ...data,
    }));
  });

  afterEach(() => vi.restoreAllMocks());

  it("encrypts the apiKey, persists pending, calls driver.start, returns submitted dto", async () => {
    const result = await svc.create(validRequest, user);

    // Persisted row has ciphertext, not plaintext.
    const createCall = prisma.benchmarkRun.create.mock.calls[0][0];
    expect(createCall.data.apiKeyCipher).not.toBe("sk-12345");
    expect(createCall.data.apiKeyCipher).toMatch(/^v1:/);
    expect(createCall.data.state).toBe("pending");

    // Driver was called with decrypted ctx.
    const driverCall = driver.start.mock.calls[0][0];
    expect(driverCall.apiKey).toBe("sk-12345");
    expect(driverCall.benchmarkId).toBe("ckxxx1");
    expect(driverCall.callbackUrl).toBe("http://localhost:3001");
    expect(driverCall.callbackToken).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(driverCall.maxDurationSeconds).toBe(1800);

    // Row was updated to submitted with the handle.
    const updateCall = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(updateCall.data.state).toBe("submitted");
    expect(updateCall.data.jobName).toBe("subprocess:1234");

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
    expect(prisma.benchmarkRun.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate active name with BENCHMARK_NAME_IN_USE", async () => {
    prisma.benchmarkRun.count.mockResolvedValue(1);
    await expect(svc.create(validRequest, user)).rejects.toMatchObject({
      response: { code: "BENCHMARK_NAME_IN_USE" },
      status: 409,
    });
    expect(prisma.benchmarkRun.create).not.toHaveBeenCalled();
  });

  it("marks the row failed when driver.start throws", async () => {
    driver.start.mockRejectedValue(new Error("rbac denied"));
    await expect(svc.create(validRequest, user)).rejects.toThrow(/rbac denied/);
    const updateCall = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(updateCall.data.state).toBe("failed");
    expect(updateCall.data.stateMessage).toMatch(/rbac denied/);
  });
});

describe("BenchmarkService.list + detail", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never);
  });

  function row(over: Partial<{ id: string; name: string; userId: string }> = {}) {
    return {
      id: over.id ?? "r1",
      userId: over.userId ?? user.sub,
      apiKeyCipher: "<encrypted>",
      apiUrl: "https://x",
      apiType: "chat",
      model: "m",
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: over.name ?? "n",
      description: null,
      state: "running",
      stateMessage: null,
      progress: 0.4,
      jobName: "subprocess:1",
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: new Date("2026-04-26T00:00:01Z"),
      completedAt: null,
    };
  }

  it("scopes non-admin queries to the caller's userId", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([row({ id: "a" })]);
    await svc.list({ limit: 20 }, user);
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.userId).toBe(user.sub);
  });

  it("admin queries are not scoped by userId", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20 }, { ...user, roles: ["admin"] });
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.userId).toBeUndefined();
  });

  it("returns peek+1 next-cursor when there are more rows", async () => {
    const rows = Array.from({ length: 21 }, (_v, i) => row({ id: `r${i}` }));
    prisma.benchmarkRun.findMany.mockResolvedValue(rows);
    const out = await svc.list({ limit: 20 }, user);
    expect(out.items).toHaveLength(20);
    expect(out.nextCursor).toBe("r19");
  });

  it("nextCursor is null when at the end", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([row({ id: "r0" })]);
    const out = await svc.list({ limit: 20 }, user);
    expect(out.nextCursor).toBeNull();
  });

  it("applies state + profile filters when provided", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20, state: "running", profile: "latency" }, user);
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.state).toBe("running");
    expect(args.where.profile).toBe("latency");
  });

  it("applies search as case-insensitive name contains", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20, search: "Foo" }, user);
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.name).toEqual({ contains: "Foo", mode: "insensitive" });
  });

  it("detail returns the full row sans apiKeyCipher", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(row({ id: "x" }));
    const dto = await svc.detail("x", user);
    expect(dto.id).toBe("x");
    expect(dto).not.toHaveProperty("apiKeyCipher");
  });

  it("detail returns 404 for non-existent / non-owned rows", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(null);
    await expect(svc.detail("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});

describe("BenchmarkService.cancel", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never);
    prisma.benchmarkRun.update.mockImplementation(async ({ where: { id }, data }) => ({
      id,
      userId: user.sub,
      apiKeyCipher: "<encrypted>",
      apiUrl: "https://x",
      apiType: "chat",
      model: "m",
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: "n",
      description: null,
      state: data.state ?? "running",
      stateMessage: data.stateMessage ?? null,
      progress: 0.5,
      jobName: "subprocess:1",
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: new Date("2026-04-26T00:00:01Z"),
      completedAt: data.completedAt ?? null,
    }));
  });

  it("cancel of pending: marks canceled without calling driver", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue({
      id: "r1",
      userId: user.sub,
      state: "pending",
      jobName: null,
    });
    await svc.cancel("r1", user);
    expect(driver.cancel).not.toHaveBeenCalled();
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("canceled");
  });

  it("cancel of running: calls driver.cancel and marks canceled", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue({
      id: "r1",
      userId: user.sub,
      state: "running",
      jobName: "subprocess:1",
    });
    await svc.cancel("r1", user);
    expect(driver.cancel).toHaveBeenCalledWith("subprocess:1");
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("canceled");
  });

  it("cancel still marks canceled if driver.cancel throws (best effort)", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue({
      id: "r1",
      userId: user.sub,
      state: "running",
      jobName: "subprocess:1",
    });
    driver.cancel.mockRejectedValue(new Error("k8s glitch"));
    await svc.cancel("r1", user);
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("canceled");
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "cancel of terminal state %s rejects with BENCHMARK_ALREADY_TERMINAL",
    async (state) => {
      prisma.benchmarkRun.findFirst.mockResolvedValue({
        id: "r1",
        userId: user.sub,
        state,
        jobName: null,
      });
      await expect(svc.cancel("r1", user)).rejects.toMatchObject({
        response: { code: "BENCHMARK_ALREADY_TERMINAL" },
        status: 400,
      });
    },
  );

  it("cancel returns 404 for missing / non-owned", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(null);
    await expect(svc.cancel("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});

describe("BenchmarkService.delete", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never);
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "deletes terminal-state row %s",
    async (state) => {
      prisma.benchmarkRun.findFirst.mockResolvedValue({ id: "r1", userId: user.sub, state });
      prisma.benchmarkRun.delete.mockResolvedValue({});
      await svc.delete("r1", user);
      expect(prisma.benchmarkRun.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    },
  );

  it.each(["pending", "submitted", "running"] as const)(
    "rejects delete of non-terminal state %s with BENCHMARK_NOT_TERMINAL",
    async (state) => {
      prisma.benchmarkRun.findFirst.mockResolvedValue({ id: "r1", userId: user.sub, state });
      await expect(svc.delete("r1", user)).rejects.toMatchObject({
        response: { code: "BENCHMARK_NOT_TERMINAL" },
        status: 409,
      });
      expect(prisma.benchmarkRun.delete).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for missing / non-owned", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(null);
    await expect(svc.delete("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});

describe("BenchmarkService.handleStateCallback", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never);
  });

  it("missing row: returns silently without UPDATE", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue(null);
    await svc.handleStateCallback("missing", { state: "running" });
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });

  it("submitted → running: UPDATE state and progress", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "submitted" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    await svc.handleStateCallback("r1", { state: "running", progress: 0.1 });
    expect(prisma.benchmarkRun.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { state: "running", progress: 0.1, stateMessage: null },
    });
  });

  it("running → running (duplicate): no UPDATE", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "running" });
    await svc.handleStateCallback("r1", { state: "running" });
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });

  it("running → completed: UPDATE with completedAt", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "running" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    await svc.handleStateCallback("r1", { state: "completed", progress: 1 });
    const args = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(args.data.state).toBe("completed");
    expect(args.data.completedAt).toBeInstanceOf(Date);
    expect(args.data.progress).toBe(1);
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "%s → running: silent warn, no UPDATE (forward-only)",
    async (state) => {
      prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state });
      await svc.handleStateCallback("r1", { state: "running" });
      expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
    },
  );

  it("running → failed: UPDATE with stateMessage truncated to 2048 chars", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "running" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    const huge = "x".repeat(5000);
    await svc.handleStateCallback("r1", { state: "failed", stateMessage: huge });
    const args = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(args.data.state).toBe("failed");
    expect((args.data.stateMessage as string).length).toBeLessThanOrEqual(2048);
  });
});

describe("BenchmarkService.handleMetricsCallback", () => {
  let prisma: PrismaStub;
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
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig() as never);
  });

  it("writes metrics regardless of state (forensic value)", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "failed" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    await svc.handleMetricsCallback("r1", {
      metricsSummary: summary,
      rawMetrics: { foo: 1 },
      logs: "tail",
    });
    const args = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(args.data.metricsSummary).toEqual(summary);
    expect(args.data.rawMetrics).toEqual({ foo: 1 });
    expect(args.data.logs).toBe("tail");
    // state was NOT touched
    expect(args.data.state).toBeUndefined();
  });

  it("missing row: silent ok", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue(null);
    await svc.handleMetricsCallback("missing", {
      metricsSummary: summary,
      rawMetrics: null,
    });
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });
});
