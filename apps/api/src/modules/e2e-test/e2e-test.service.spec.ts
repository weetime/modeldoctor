import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../database/prisma.service.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { RunRepository } from "../run/run.repository.js";
import { E2ETestService } from "./e2e-test.service.js";

function makeConn(overrides: Partial<DecryptedConnection> = {}): DecryptedConnection {
  return {
    id: "conn-e2e-1",
    name: "test-conn",
    baseUrl: "http://localhost:8000",
    apiKey: "test-key",
    model: "test-model",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    ...overrides,
  };
}

describe("E2ETestService", () => {
  let service: E2ETestService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        E2ETestService,
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

    service = moduleRef.get(E2ETestService);
    prisma = moduleRef.get(PrismaService);

    await prisma.run.deleteMany({ where: { kind: "e2e" } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-svc-" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a Run row with kind=e2e and returns runId", async () => {
    const u = await prisma.user.create({
      data: { email: "e2e-svc-test@example.com", passwordHash: "x" },
    });

    // Mock executeProbes so no real HTTP calls are made
    const mockResults = [
      {
        probe: "chat-text" as const,
        pass: true,
        latencyMs: 42,
        checks: [{ name: "status", pass: true, info: "200" }],
        details: { content: "hello" },
      },
    ];
    vi.spyOn(
      service as unknown as { executeProbes: () => unknown },
      "executeProbes",
    ).mockResolvedValue(mockResults);

    const result = await service.run(u.id, makeConn(), {
      connectionId: "conn-e2e-1",
      probes: ["chat-text"],
    });

    expect(result.runId).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);

    const row = await prisma.run.findUnique({ where: { id: result.runId } });
    expect(row?.kind).toBe("e2e");
    expect(row?.tool).toBe("e2e");
    expect(row?.mode).toBe("correctness");
    expect(row?.driverKind).toBe("local");
    expect(row?.userId).toBe(u.id);
    expect(["completed", "failed"]).toContain(row?.status);
  });

  it("marks run as failed when all probes fail", async () => {
    const u = await prisma.user.create({
      data: { email: "e2e-svc-fail@example.com", passwordHash: "x" },
    });

    const mockResults = [
      {
        probe: "chat-text" as const,
        pass: false,
        latencyMs: null,
        checks: [{ name: "status", pass: false, info: "500" }],
        details: { error: "service unavailable" },
      },
    ];
    vi.spyOn(
      service as unknown as { executeProbes: () => unknown },
      "executeProbes",
    ).mockResolvedValue(mockResults);

    const result = await service.run(u.id, makeConn(), {
      connectionId: "conn-e2e-1",
      probes: ["chat-text"],
    });

    expect(result.runId).toBeDefined();
    expect(result.success).toBe(false);

    const row = await prisma.run.findUnique({ where: { id: result.runId } });
    expect(row?.status).toBe("failed");
    expect(row?.summaryMetrics).toMatchObject({ total: 1, passed: 0, failed: 1 });
  });

  it("transitions run through pending -> running -> completed lifecycle", async () => {
    // We'll observe the final state after the run completes
    vi.spyOn(
      service as unknown as { executeProbes: () => unknown },
      "executeProbes",
    ).mockResolvedValue([
      {
        probe: "chat-text" as const,
        pass: true,
        latencyMs: 10,
        checks: [],
        details: {},
      },
    ]);

    const result = await service.run(undefined, makeConn(), {
      connectionId: "conn-e2e-1",
      probes: ["chat-text"],
    });

    const row = await prisma.run.findUnique({ where: { id: result.runId } });
    expect(row?.status).toBe("completed");
    expect(row?.startedAt).toBeInstanceOf(Date);
    expect(row?.completedAt).toBeInstanceOf(Date);
    // summaryMetrics and rawOutput persisted
    expect(row?.summaryMetrics).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(row?.rawOutput).toHaveProperty("results");
  });
});
