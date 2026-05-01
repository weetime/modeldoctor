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
              if (key === "DATABASE_URL") return process.env["DATABASE_URL"];
              return undefined;
            },
          },
        },
      ],
    }).compile();

    repo = moduleRef.get(RunRepository);
    prisma = moduleRef.get(PrismaService);

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

    const page2 = await repo.list({
      kind: "benchmark",
      limit: 2,
      cursor: page1.nextCursor!,
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
});
