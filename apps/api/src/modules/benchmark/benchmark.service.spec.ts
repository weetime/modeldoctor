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
