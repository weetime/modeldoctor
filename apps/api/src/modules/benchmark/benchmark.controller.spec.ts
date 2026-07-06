import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { SseJwtAuthGuard } from "../auth/sse-jwt-auth.guard.js";
import { BaselineService } from "../baseline/baseline.service.js";
import { BenchmarkTemplateRepository } from "../benchmark-template/benchmark-template.repository.js";
import { ConnectionService } from "../connection/connection.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { NotifyService } from "../notifications/notify.service.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";
import { SseHub } from "./sse/sse-hub.service.js";

// Stub adapter registry to avoid pulling in the real (Phase 1 stubbed) adapters'
// buildCommand which throws "not implemented". The controller spec only needs
// to verify wiring; service-level adapter behavior is covered in
// benchmark.service.spec.
vi.mock("@modeldoctor/tool-adapters", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    // Stub applyScenarioConstraints so the controller spec can pass minimal
    // params without satisfying real per-scenario zod narrowings; service-
    // level scenario behavior is covered in benchmark.service.spec.
    applyScenarioConstraints: () => ({ parse: (x: unknown) => x }),
    byTool: () => ({
      name: "guidellm",
      // Default stub claims to support inference + capacity so the upfront
      // scenario-tool guard in BenchmarkService.create doesn't reject.
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

const mockRunner = {
  start: vi.fn(async () => ({ handle: "subprocess:1234" })),
  cancel: vi.fn(async () => undefined),
  cleanup: vi.fn(async () => undefined),
};

const mockConnections = {
  getOwnedDecrypted: vi.fn(async (_userId: string, id: string) => ({
    id,
    name: "conn",
    baseUrl: "http://upstream/",
    apiKey: "k",
    model: "m",
    customHeaders: "{}",
    queryParams: "",
    category: "text" as const,
  })),
};

const ENV_DEFAULTS: Record<string, unknown> = {
  BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 1800,
  RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:test",
  RUNNER_IMAGE_VEGETA: "md-runner-vegeta:test",
};

describe("BenchmarkController", () => {
  let controller: BenchmarkController;
  let prisma: PrismaService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [BenchmarkController],
      providers: [
        BenchmarkService,
        BenchmarkRepository,
        BenchmarkChartsService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "DATABASE_URL") return process.env.DATABASE_URL;
              return ENV_DEFAULTS[key];
            },
          },
        },
        { provide: K8sBenchmarkRunner, useValue: mockRunner },
        { provide: ConnectionService, useValue: mockConnections },
        {
          provide: BenchmarkTemplateRepository,
          useValue: { findByIdOrNull: vi.fn(async () => null) },
        },
        {
          // Mock BaselineService — controller spec doesn't exercise the
          // create()/baselineId path, so a no-op existsById is enough.
          provide: BaselineService,
          useValue: { existsById: vi.fn(async () => false) },
        },
        { provide: NotifyService, useValue: { emit: vi.fn() } },
        {
          provide: SseHub,
          useValue: { subscribe: vi.fn(), publish: vi.fn(), close: vi.fn(), has: vi.fn() },
        },
        {
          // Controller spec never exercises the agent-scenario (tau2) path,
          // so a no-op getDecrypted is enough to satisfy DI.
          provide: LlmJudgeService,
          useValue: { getDecrypted: vi.fn(async () => null) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SseJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(BenchmarkController);
    prisma = moduleRef.get(PrismaService);

    await prisma.baseline.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 404 for unknown benchmark", async () => {
    const user = { sub: "any-user", email: "x", roles: [] };
    await expect(controller.detail(user as never, "nope")).rejects.toThrow(/not found/i);
  });

  it("lists benchmarks filtered by scenario AND scoped to current user", async () => {
    const owner = await prisma.user.create({
      data: { email: "rc-owner@example.com", passwordHash: "x" },
    });
    const stranger = await prisma.user.create({
      data: { email: "rc-stranger@example.com", passwordHash: "x" },
    });

    await prisma.benchmark.create({
      data: {
        userId: owner.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
      },
    });
    await prisma.benchmark.create({
      data: {
        userId: owner.id,
        scenario: "capacity",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
      },
    });
    await prisma.benchmark.create({
      data: {
        userId: stranger.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
      },
    });

    const ownerArg = { sub: owner.id, email: owner.email, roles: [] };
    const result = await controller.list(ownerArg as never, {
      scenario: "inference",
      limit: 10,
      scope: "own",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].scenario).toBe("inference");
    expect(result.items[0].userId).toBe(owner.id);
  });

  it("does not leak internal fields in detail response", async () => {
    const owner = await prisma.user.create({
      data: { email: "rc-cipher@example.com", passwordHash: "x" },
    });
    const benchmark = await prisma.benchmark.create({
      data: {
        userId: owner.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
      },
    });

    const ownerArg = { sub: owner.id, email: owner.email, roles: [] };
    const dto = await controller.detail(ownerArg as never, benchmark.id);
    expect(dto).not.toHaveProperty("apiKeyCipher");
  });

  it("returns 404 when reading another user's benchmark", async () => {
    const owner = await prisma.user.create({
      data: { email: "rc-iso-owner@example.com", passwordHash: "x" },
    });
    const stranger = await prisma.user.create({
      data: { email: "rc-iso-stranger@example.com", passwordHash: "x" },
    });
    const benchmark = await prisma.benchmark.create({
      data: {
        userId: owner.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
      },
    });

    const strangerArg = {
      sub: stranger.id,
      email: stranger.email,
      roles: [],
    };
    await expect(controller.detail(strangerArg as never, benchmark.id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("create writes a row and starts the driver", async () => {
    const user = await prisma.user.create({
      data: { email: "rc-create@example.com", passwordHash: "x" },
    });
    const conn = await prisma.connection.create({
      data: {
        userId: user.id,
        name: "test-conn",
        baseUrl: "http://upstream/",
        apiKeyCipher: "ciphertext",
        model: "m",
        customHeaders: "{}",
        queryParams: "",
        category: "text",
      },
    });
    const userArg = { sub: user.id, email: user.email, roles: [] };
    const dto = await controller.create(userArg as never, {
      tool: "guidellm",
      scenario: "inference",
      connectionId: conn.id,
      name: "rc-create-smoke",
      params: {},
    });
    expect(dto.status).toBe("submitted");
    expect(dto.driverHandle).toBe("subprocess:1234");
    expect(mockRunner.start).toHaveBeenCalledTimes(1);
  });

  it("cancel transitions a running benchmark to canceled", async () => {
    const user = await prisma.user.create({
      data: { email: "rc-cancel@example.com", passwordHash: "x" },
    });
    const benchmark = await prisma.benchmark.create({
      data: {
        userId: user.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
        status: "running",
        driverHandle: "subprocess:9999",
      },
    });
    const userArg = { sub: user.id, email: user.email, roles: [] };
    const dto = await controller.cancel(userArg as never, benchmark.id);
    expect(dto.status).toBe("canceled");
    expect(mockRunner.cancel).toHaveBeenCalledWith("subprocess:9999");
  });

  it("delete removes a terminal benchmark", async () => {
    const user = await prisma.user.create({
      data: { email: "rc-delete@example.com", passwordHash: "x" },
    });
    const benchmark = await prisma.benchmark.create({
      data: {
        userId: user.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
        status: "completed",
      },
    });
    const userArg = { sub: user.id, email: user.email, roles: [] };
    await controller.delete(userArg as never, benchmark.id);
    const after = await prisma.benchmark.findUnique({ where: { id: benchmark.id } });
    expect(after).toBeNull();
  });

  it("bulkDelete removes only the caller's rows and reports the count", async () => {
    const owner = await prisma.user.create({
      data: { email: "rc-bulk-owner@example.com", passwordHash: "x" },
    });
    const stranger = await prisma.user.create({
      data: { email: "rc-bulk-stranger@example.com", passwordHash: "x" },
    });
    const mk = (userId: string) =>
      prisma.benchmark.create({
        data: {
          userId,
          scenario: "inference",
          tool: "guidellm",
          name: "b",
          params: {},
          status: "completed",
        },
      });
    const a = await mk(owner.id);
    const b = await mk(owner.id);
    const theirs = await mk(stranger.id);

    const ownerArg = { sub: owner.id, email: owner.email, roles: [] };
    const result = await controller.bulkDelete(ownerArg as never, {
      ids: [a.id, b.id, theirs.id, "nonexistent"],
    });

    expect(result.deleted).toBe(2);
    expect(await prisma.benchmark.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await prisma.benchmark.findUnique({ where: { id: b.id } })).toBeNull();
    // The stranger's row must survive a non-admin bulk delete.
    expect(await prisma.benchmark.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  describe("admin authz", () => {
    it("rejects scope=all from non-admin caller (403)", async () => {
      const user = { sub: "u1", email: "u1@x", roles: [] };
      await expect(
        controller.list(user as never, { limit: 10, scope: "all" } as never),
      ).rejects.toThrow(/admin role required/i);
    });

    it("returns benchmarks across all users when admin requests scope=all", async () => {
      const a = await prisma.user.create({ data: { email: "azz-1@x", passwordHash: "x" } });
      const b = await prisma.user.create({ data: { email: "azz-2@x", passwordHash: "x" } });
      for (const userId of [a.id, b.id]) {
        await prisma.benchmark.create({
          data: {
            userId,
            scenario: "inference",
            tool: "guidellm",
            name: "test-benchmark",
            params: {},
          },
        });
      }
      const admin = { sub: a.id, email: a.email, roles: ["admin"] };
      const result = await controller.list(
        admin as never,
        {
          limit: 10,
          scope: "all",
        } as never,
      );
      expect(result.items).toHaveLength(2);
    });

    it("scopes to own when scope omitted", async () => {
      const a = await prisma.user.create({ data: { email: "azz-3@x", passwordHash: "x" } });
      const b = await prisma.user.create({ data: { email: "azz-4@x", passwordHash: "x" } });
      for (const userId of [a.id, b.id]) {
        await prisma.benchmark.create({
          data: {
            userId,
            scenario: "inference",
            tool: "guidellm",
            name: "test-benchmark",
            params: {},
          },
        });
      }
      const ua = { sub: a.id, email: a.email, roles: [] };
      const result = await controller.list(ua as never, { limit: 10 } as never);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].userId).toBe(a.id);
    });

    it("admin can read another user's benchmark by id", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-5@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-6@x", passwordHash: "x" } });
      const benchmark = await prisma.benchmark.create({
        data: {
          userId: owner.id,
          scenario: "inference",
          tool: "guidellm",
          name: "test-benchmark",
          params: {},
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      const dto = await controller.detail(adminArg as never, benchmark.id);
      expect(dto.id).toBe(benchmark.id);
      expect(dto.userId).toBe(owner.id);
    });

    it("non-admin gets 404 reading another user's benchmark", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-7@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-8@x", passwordHash: "x" },
      });
      const benchmark = await prisma.benchmark.create({
        data: {
          userId: owner.id,
          scenario: "inference",
          tool: "guidellm",
          name: "test-benchmark",
          params: {},
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.detail(strangerArg as never, benchmark.id)).rejects.toThrow(
        /not found/i,
      );
    });

    it("admin can cancel another user's running benchmark", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-9@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-10@x", passwordHash: "x" } });
      const benchmark = await prisma.benchmark.create({
        data: {
          userId: owner.id,
          scenario: "inference",
          tool: "guidellm",
          name: "test-benchmark",
          params: {},
          status: "running",
          driverHandle: "subprocess:cancel-me",
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      const dto = await controller.cancel(adminArg as never, benchmark.id);
      expect(dto.status).toBe("canceled");
    });

    it("non-admin gets 404 cancelling another user's benchmark", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-11@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-12@x", passwordHash: "x" },
      });
      const benchmark = await prisma.benchmark.create({
        data: {
          userId: owner.id,
          scenario: "inference",
          tool: "guidellm",
          name: "test-benchmark",
          params: {},
          status: "running",
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.cancel(strangerArg as never, benchmark.id)).rejects.toThrow(
        /not found/i,
      );
    });

    it("admin can delete another user's terminal benchmark", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-13@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-14@x", passwordHash: "x" } });
      const benchmark = await prisma.benchmark.create({
        data: {
          userId: owner.id,
          scenario: "inference",
          tool: "guidellm",
          name: "test-benchmark",
          params: {},
          status: "completed",
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      await controller.delete(adminArg as never, benchmark.id);
      const after = await prisma.benchmark.findUnique({ where: { id: benchmark.id } });
      expect(after).toBeNull();
    });

    it("non-admin gets 404 deleting another user's benchmark", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-15@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-16@x", passwordHash: "x" },
      });
      const benchmark = await prisma.benchmark.create({
        data: {
          userId: owner.id,
          scenario: "inference",
          tool: "guidellm",
          name: "test-benchmark",
          params: {},
          status: "completed",
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.delete(strangerArg as never, benchmark.id)).rejects.toThrow(
        /not found/i,
      );
    });
  });
});

describe("BenchmarkController.getCharts (F3 #88)", () => {
  let controller: BenchmarkController;
  let prisma: PrismaService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [BenchmarkController],
      providers: [
        BenchmarkService,
        BenchmarkRepository,
        BenchmarkChartsService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "DATABASE_URL") return process.env.DATABASE_URL;
              return ENV_DEFAULTS[key];
            },
          },
        },
        { provide: K8sBenchmarkRunner, useValue: mockRunner },
        { provide: ConnectionService, useValue: mockConnections },
        {
          provide: BenchmarkTemplateRepository,
          useValue: { findByIdOrNull: vi.fn(async () => null) },
        },
        {
          // Mock BaselineService — controller spec doesn't exercise the
          // create()/baselineId path, so a no-op existsById is enough.
          provide: BaselineService,
          useValue: { existsById: vi.fn(async () => false) },
        },
        { provide: NotifyService, useValue: { emit: vi.fn() } },
        {
          provide: SseHub,
          useValue: { subscribe: vi.fn(), publish: vi.fn(), close: vi.fn(), has: vi.fn() },
        },
        {
          // Controller spec never exercises the agent-scenario (tau2) path,
          // so a no-op getDecrypted is enough to satisfy DI.
          provide: LlmJudgeService,
          useValue: { getDecrypted: vi.fn(async () => null) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SseJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(BenchmarkController);
    prisma = moduleRef.get(PrismaService);

    await prisma.baseline.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it("returns 200 with both nulls when Benchmark has no rawOutput.files", async () => {
    const user = await prisma.user.create({
      data: { email: "f3@example.com", passwordHash: "x" },
    });
    const benchmark = await prisma.benchmark.create({
      data: {
        userId: user.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
        status: "completed",
      },
    });
    const result = await controller.getCharts({ sub: user.id, roles: [] } as never, benchmark.id);
    expect(result).toEqual({ latencyCdf: null, ttftHistogram: null });
  });

  it("returns 200 with extracted samples for a vegeta Benchmark with attack.ndjson", async () => {
    const user = await prisma.user.create({
      data: { email: "f3v@example.com", passwordHash: "x" },
    });
    const ndjson = '{"latency":5000000}\n{"latency":10000000}\n';
    const benchmark = await prisma.benchmark.create({
      data: {
        userId: user.id,
        scenario: "inference",
        tool: "vegeta",
        name: "test-benchmark",
        params: {},
        status: "completed",
        rawOutput: {
          stdout: "",
          stderr: "",
          files: { latencies: Buffer.from(ndjson).toString("base64") },
        },
      },
    });
    const result = await controller.getCharts({ sub: user.id, roles: [] } as never, benchmark.id);
    expect(result.latencyCdf?.samples).toEqual([5, 10]);
    expect(result.ttftHistogram).toBeNull();
  });

  it("404s when the Benchmark belongs to a different user", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "x" },
    });
    const other = await prisma.user.create({
      data: { email: "other@example.com", passwordHash: "x" },
    });
    const benchmark = await prisma.benchmark.create({
      data: {
        userId: owner.id,
        scenario: "inference",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
        status: "completed",
      },
    });
    await expect(
      controller.getCharts({ sub: other.id, roles: [] } as never, benchmark.id),
    ).rejects.toThrow(/not found/i);
  });

  it("404s when Benchmark does not exist", async () => {
    const user = await prisma.user.create({
      data: { email: "f3404@example.com", passwordHash: "x" },
    });
    await expect(
      controller.getCharts({ sub: user.id, roles: [] } as never, "nonexistent-id"),
    ).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Lightweight mock-service factory for unit tests that don't need a real DB
// ---------------------------------------------------------------------------
function makeMockService() {
  return {
    list: vi.fn(),
    findByIdOrFail: vi.fn(),
    create: vi.fn(),
    cancel: vi.fn(),
    delete: vi.fn(),
    getByConnectionReports: vi.fn(),
  };
}

const USER: JwtPayload = { sub: "u_1", email: "alice@example.com", roles: [] };

describe("BenchmarkController.reportsByConnection", () => {
  let controller: BenchmarkController;
  let svc: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    svc = makeMockService();
    const moduleRef = await Test.createTestingModule({
      controllers: [BenchmarkController],
      providers: [
        { provide: BenchmarkService, useValue: svc },
        { provide: BenchmarkChartsService, useValue: {} },
        {
          provide: SseHub,
          useValue: { subscribe: vi.fn(), publish: vi.fn(), close: vi.fn(), has: vi.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SseJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BenchmarkController);
  });

  it("forwards user.sub and default range '30d' when no query param", async () => {
    svc.getByConnectionReports.mockResolvedValue({
      range: "30d",
      generatedAt: "2026-05-06T00:00:00.000Z",
      items: [],
    });
    const result = await controller.reportsByConnection(USER, undefined);
    expect(svc.getByConnectionReports).toHaveBeenCalledWith(USER.sub, "30d");
    expect(result.range).toBe("30d");
  });

  it("forwards explicit range when provided", async () => {
    svc.getByConnectionReports.mockResolvedValue({
      range: "7d",
      generatedAt: "2026-05-06T00:00:00.000Z",
      items: [],
    });
    await controller.reportsByConnection(USER, "7d");
    expect(svc.getByConnectionReports).toHaveBeenCalledWith(USER.sub, "7d");
  });
});
