import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../database/prisma.service.js";
import { RunRepository } from "./run.repository.js";

describe("RunRepository", () => {
  let repo: RunRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RunRepository,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "DATABASE_URL") return process.env.DATABASE_URL;
              return undefined;
            },
          },
        },
      ],
    }).compile();

    repo = moduleRef.get(RunRepository);
    prisma = moduleRef.get(PrismaService);

    await prisma.baseline.deleteMany();
    await prisma.run.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a benchmark run and reads it back", async () => {
    const user = await prisma.user.create({
      data: { email: "u1@example.com", passwordHash: "x" },
    });

    const created = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: { model: "llama-3-8b" },
      mode: "fixed",
      driverKind: "local",
      params: { rate: 10 },
      name: "smoke",
    });

    expect(created.id).toBeDefined();
    expect(created.status).toBe("pending");

    const fetched = await repo.findById(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.tool).toBe("guidellm");
  });

  it("lists runs with kind filter and cursor pagination", async () => {
    const user = await prisma.user.create({
      data: { email: "u2@example.com", passwordHash: "x" },
    });

    for (let i = 0; i < 5; i++) {
      await repo.create({
        userId: user.id,
        kind: i % 2 === 0 ? "benchmark" : "e2e",
        tool: i % 2 === 0 ? "guidellm" : "e2e",
        scenario: {},
        mode: i % 2 === 0 ? "fixed" : "correctness",
        driverKind: "local",
        params: {},
      });
    }

    const page1 = await repo.list({ kind: "benchmark", limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items.every((r) => r.kind === "benchmark")).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    if (!page1.nextCursor) throw new Error("expected nextCursor on page1");
    const page2 = await repo.list({
      kind: "benchmark",
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
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "vegeta",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
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
    const run = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });

    await repo.update(run.id, {
      status: "running",
      driverHandle: "subprocess:1234",
      startedAt: new Date(),
    });

    const updated = await repo.findById(run.id);
    expect(updated?.status).toBe("running");
    expect(updated?.driverHandle).toBe("subprocess:1234");
    expect(updated?.startedAt).toBeInstanceOf(Date);
  });

  it("filters by createdAt range", async () => {
    const user = await prisma.user.create({
      data: { email: "time-range@example.com", passwordHash: "x" },
    });
    // Create three runs with explicit timestamps (1 hour apart)
    for (let i = 0; i < 3; i++) {
      await prisma.run.create({
        data: {
          userId: user.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
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

  it("filters by isBaseline=true (returns only Runs that ARE a baseline)", async () => {
    const user = await prisma.user.create({
      data: { email: "is-baseline@example.com", passwordHash: "x" },
    });
    const r1 = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    await prisma.baseline.create({
      data: { userId: user.id, runId: r1.id, name: "anchor" },
    });

    const onlyBaselines = await repo.list({ isBaseline: true });
    expect(onlyBaselines.items).toHaveLength(1);
    expect(onlyBaselines.items[0].id).toBe(r1.id);
  });

  it("filters by referencesBaseline=true (returns only Runs whose baselineId is set)", async () => {
    const user = await prisma.user.create({
      data: { email: "ref-baseline@example.com", passwordHash: "x" },
    });
    const canonical = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    const baseline = await prisma.baseline.create({
      data: { userId: user.id, runId: canonical.id, name: "anchor" },
    });
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
      baselineId: baseline.id,
    });
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });

    const refs = await repo.list({ referencesBaseline: true });
    expect(refs.items).toHaveLength(1);
    expect(refs.items[0].baselineId).toBe(baseline.id);
  });

  it("findById includes baselineFor when the Run is a baseline canonical Run", async () => {
    const user = await prisma.user.create({
      data: { email: "find-baseline@example.com", passwordHash: "x" },
    });
    const r = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    await prisma.baseline.create({
      data: { userId: user.id, runId: r.id, name: "anchor" },
    });

    const fetched = await repo.findById(r.id);
    expect(fetched?.baselineFor?.name).toBe("anchor");
  });

  it("countActiveByName excludes terminal rows", async () => {
    const user = await prisma.user.create({
      data: { email: "active-by-name@example.com", passwordHash: "x" },
    });
    // Active rows
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
      name: "shared-name",
    });
    const submitted = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
      name: "shared-name",
    });
    await repo.update(submitted.id, { status: "submitted" });
    // Terminal row (should not count)
    const completed = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
      name: "shared-name",
    });
    await repo.update(completed.id, { status: "completed" });
    // Different-name active row (should not count)
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
      name: "other-name",
    });
    // Different-user active row with same name (should not count)
    const otherUser = await prisma.user.create({
      data: { email: "active-by-name-2@example.com", passwordHash: "x" },
    });
    await repo.create({
      userId: otherUser.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
      name: "shared-name",
    });

    const n = await repo.countActiveByName(user.id, "shared-name");
    expect(n).toBe(2);
  });
});
