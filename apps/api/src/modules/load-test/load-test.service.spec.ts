import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../database/prisma.service.js";
import { RunRepository } from "../run/run.repository.js";
import { LoadTestService } from "./load-test.service.js";

describe("LoadTestService", () => {
  let service: LoadTestService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoadTestService,
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

    service = moduleRef.get(LoadTestService);
    prisma = moduleRef.get(PrismaService);

    await prisma.run.deleteMany({ where: { tool: "vegeta", userId: { not: undefined } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "lt-svc-" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("listRuns returns only vegeta-tool runs for the user", async () => {
    const u = await prisma.user.create({
      data: { email: "lt-svc@example.com", passwordHash: "x" },
    });

    // Create a guidellm run — should NOT appear
    await prisma.run.create({
      data: {
        userId: u.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
      },
    });

    // Create a vegeta run — should appear
    await prisma.run.create({
      data: {
        userId: u.id,
        kind: "benchmark",
        tool: "vegeta",
        scenario: { apiType: "chat", apiBaseUrl: "http://x", model: "m", rate: 5, duration: 10 },
        mode: "fixed",
        driverKind: "local",
        params: {},
        status: "completed",
      },
    });

    const result = await service.listRuns(
      { limit: 20 },
      { sub: u.id, email: "lt-svc@example.com", roles: ["user"] },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe("completed");
    expect(result.items[0].apiType).toBe("chat");
    expect(result.nextCursor).toBeNull();
  });
});
