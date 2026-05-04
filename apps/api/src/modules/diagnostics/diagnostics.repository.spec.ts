import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { DiagnosticsRepository } from "./diagnostics.repository.js";

describe("DiagnosticsRepository", () => {
  let repo: DiagnosticsRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DiagnosticsRepository,
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

    repo = moduleRef.get(DiagnosticsRepository);
    prisma = moduleRef.get(PrismaService);

    await prisma.diagnosticsRun.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("create + findById round-trips a row", async () => {
    const created = await repo.create({
      userId: null,
      connectionId: null,
      probes: ["chat-text"],
      pathOverride: {},
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("completed");

    const fetched = await repo.findById(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.probes).toEqual(["chat-text"]);
  });

  it("update marks the row as failed and writes statusMessage", async () => {
    const row = await repo.create({
      userId: null,
      connectionId: null,
      probes: ["chat-text"],
      pathOverride: {},
    });
    await repo.update(row.id, {
      status: "failed",
      statusMessage: "boom",
      results: [],
      summary: { total: 0, passed: 0, failed: 0 },
      completedAt: new Date(),
    });
    const re = await repo.findById(row.id);
    expect(re?.status).toBe("failed");
    expect(re?.statusMessage).toBe("boom");
  });
});
