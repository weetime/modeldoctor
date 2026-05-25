import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkRepository } from "./benchmark.repository.js";

const configServiceMock = {
  provide: ConfigService,
  useValue: {
    get: (key: string) => {
      if (key === "DATABASE_URL") return process.env.DATABASE_URL;
      return undefined;
    },
  },
};

describe("BenchmarkRepository", () => {
  let repo: BenchmarkRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [BenchmarkRepository, PrismaService, configServiceMock],
    }).compile();

    repo = moduleRef.get(BenchmarkRepository);
    prisma = moduleRef.get(PrismaService);

    await prisma.baseline.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a benchmark and reads it back", async () => {
    const user = await prisma.user.create({
      data: { email: "u1@example.com", passwordHash: "x" },
    });

    const created = await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "guidellm",
      params: { rate: 10 },
      name: "smoke",
    });

    expect(created.id).toBeDefined();
    expect(created.status).toBe("pending");

    const fetched = await repo.findById(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.tool).toBe("guidellm");
    expect(fetched?.scenario).toBe("inference");
  });

  it("lists benchmarks with scenario filter and cursor pagination", async () => {
    const user = await prisma.user.create({
      data: { email: "u2@example.com", passwordHash: "x" },
    });

    for (let i = 0; i < 5; i++) {
      await repo.create({
        userId: user.id,
        scenario: i % 2 === 0 ? "inference" : "capacity",
        tool: "guidellm",
        name: "test-benchmark",
        params: {},
      });
    }

    const page1 = await repo.list({ scenario: "inference", limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items.every((r) => r.scenario === "inference")).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    if (!page1.nextCursor) throw new Error("expected nextCursor on page1");
    const page2 = await repo.list({
      scenario: "inference",
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it("filters by tool", async () => {
    const user = await prisma.user.create({
      data: { email: "lt-tool@example.com", passwordHash: "x" },
    });
    await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "guidellm",
      name: "test-benchmark",
      params: {},
    });
    await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "vegeta",
      name: "test-benchmark",
      params: {},
    });

    const result = await repo.list({ tool: "vegeta" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].tool).toBe("vegeta");
  });

  it("updates status + driverHandle", async () => {
    const user = await prisma.user.create({
      data: { email: "u3@example.com", passwordHash: "x" },
    });
    const benchmark = await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "guidellm",
      name: "test-benchmark",
      params: {},
    });

    await repo.update(benchmark.id, {
      status: "running",
      driverHandle: "subprocess:1234",
      startedAt: new Date(),
    });

    const updated = await repo.findById(benchmark.id);
    expect(updated?.status).toBe("running");
    expect(updated?.driverHandle).toBe("subprocess:1234");
    expect(updated?.startedAt).toBeInstanceOf(Date);
  });

  it("filters by createdAt range", async () => {
    const user = await prisma.user.create({
      data: { email: "time-range@example.com", passwordHash: "x" },
    });
    // Create three benchmarks with explicit timestamps (1 hour apart)
    for (let i = 0; i < 3; i++) {
      await prisma.benchmark.create({
        data: {
          userId: user.id,
          scenario: "inference",
          tool: "guidellm",
          name: "test-benchmark",
          params: {},
          createdAt: new Date(`2026-04-30T0${i}:00:00Z`),
        },
      });
    }
    const between = await repo.list({
      createdAfter: "2026-04-30T01:00:00Z",
      createdBefore: "2026-04-30T01:30:00Z",
    });
    expect(between.items).toHaveLength(1);
    expect(between.items[0].createdAt.toISOString()).toBe("2026-04-30T01:00:00.000Z");

    const fromOne = await repo.list({ createdAfter: "2026-04-30T01:00:00Z" });
    expect(fromOne.items).toHaveLength(2);

    const untilOne = await repo.list({ createdBefore: "2026-04-30T01:00:00Z" });
    expect(untilOne.items).toHaveLength(2);
  });

  it("countActiveByName excludes terminal rows", async () => {
    const user = await prisma.user.create({
      data: { email: "active-by-name@example.com", passwordHash: "x" },
    });
    // Active rows
    await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "guidellm",
      params: {},
      name: "shared-name",
    });
    const submitted = await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "guidellm",
      params: {},
      name: "shared-name",
    });
    await repo.update(submitted.id, { status: "submitted" });
    // Terminal row (should not count)
    const completed = await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "guidellm",
      params: {},
      name: "shared-name",
    });
    await repo.update(completed.id, { status: "completed" });
    // Different-name active row (should not count)
    await repo.create({
      userId: user.id,
      scenario: "inference",
      tool: "guidellm",
      params: {},
      name: "other-name",
    });
    // Different-user active row with same name (should not count)
    const otherUser = await prisma.user.create({
      data: { email: "active-by-name-2@example.com", passwordHash: "x" },
    });
    await repo.create({
      userId: otherUser.id,
      scenario: "inference",
      tool: "guidellm",
      params: {},
      name: "shared-name",
    });

    const n = await repo.countActiveByName(user.id, "shared-name");
    expect(n).toBe(2);
  });
});

describe("BenchmarkRepository.updateGuarded", () => {
  let repo: BenchmarkRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [BenchmarkRepository, PrismaService, configServiceMock],
    }).compile();
    repo = mod.get(BenchmarkRepository);
    prisma = mod.get(PrismaService);
    await prisma.baseline.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("updates when current status is in allowedStatuses", async () => {
    const b = await prisma.benchmark.create({
      data: {
        name: "t",
        scenario: "chat",
        tool: "guidellm",
        params: {},
        status: "running",
      },
    });
    const updated = await repo.updateGuarded(b.id, ["pending", "submitted", "running"], {
      status: "failed",
      statusMessage: "watcher: test",
    });
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe("failed");
    expect(updated?.statusMessage).toBe("watcher: test");
  });

  it("returns null when current status is NOT in allowedStatuses", async () => {
    const b = await prisma.benchmark.create({
      data: {
        name: "t",
        scenario: "chat",
        tool: "guidellm",
        params: {},
        status: "completed",
      },
    });
    const updated = await repo.updateGuarded(b.id, ["pending", "submitted", "running"], {
      status: "failed",
      statusMessage: "should not apply",
    });
    expect(updated).toBeNull();
    const reloaded = await prisma.benchmark.findUnique({ where: { id: b.id } });
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.statusMessage).toBeNull();
  });

  it("returns null when row does not exist", async () => {
    const updated = await repo.updateGuarded("00000000-0000-0000-0000-000000000000", ["running"], {
      status: "failed",
    });
    expect(updated).toBeNull();
  });
});
