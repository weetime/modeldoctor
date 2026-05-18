import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { NotifyService } from "../notifications/notify.service.js";
import { DiagnosticsRepository } from "./diagnostics.repository.js";
import { DiagnosticsService } from "./diagnostics.service.js";

function makeConn(overrides: Partial<DecryptedConnection> & { id: string }): DecryptedConnection {
  return {
    kind: "model",
    name: "test-conn",
    baseUrl: "http://localhost:8000",
    apiKey: "test-key",
    model: "test-model",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tokenizerHfId: null,
    prometheusUrl: null,
    prometheusDatasourceId: null,
    serverKind: null,
    ...overrides,
  };
}

async function seedUserAndConnection(
  prisma: PrismaService,
  email: string,
): Promise<{ userId: string; connectionId: string }> {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x" },
  });
  const conn = await prisma.connection.create({
    data: {
      userId: user.id,
      name: `c-${user.id}`,
      baseUrl: "http://localhost:8000",
      apiKeyCipher: "v1:placeholder",
      model: "test-model",
      customHeaders: "",
      queryParams: "",
      category: "chat",
      tags: [],
    },
  });
  return { userId: user.id, connectionId: conn.id };
}

describe("DiagnosticsService", () => {
  let service: DiagnosticsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DiagnosticsService,
        DiagnosticsRepository,
        PrismaService,
        { provide: NotifyService, useValue: { emit: vi.fn() } },
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

    service = moduleRef.get(DiagnosticsService);
    prisma = moduleRef.get(PrismaService);

    await prisma.diagnosticsRun.deleteMany();
    await prisma.connection.deleteMany({ where: { user: { email: { startsWith: "e2e-svc-" } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-svc-" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a DiagnosticsRun row and returns diagnosticsRunId", async () => {
    const { userId, connectionId } = await seedUserAndConnection(
      prisma,
      "e2e-svc-test@example.com",
    );

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

    const result = await service.run(userId, makeConn({ id: connectionId }), {
      connectionId,
      probes: ["chat-text"],
    });

    expect(result.diagnosticsRunId).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);

    const row = await prisma.diagnosticsRun.findUnique({
      where: { id: result.diagnosticsRunId },
    });
    expect(row?.userId).toBe(userId);
    expect(row?.connectionId).toBe(connectionId);
    expect(row?.probes).toEqual(["chat-text"]);
    expect(["completed", "failed"]).toContain(row?.status);
  });

  it("marks run as failed when all probes fail", async () => {
    const { userId, connectionId } = await seedUserAndConnection(
      prisma,
      "e2e-svc-fail@example.com",
    );

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

    const result = await service.run(userId, makeConn({ id: connectionId }), {
      connectionId,
      probes: ["chat-text"],
    });

    expect(result.diagnosticsRunId).toBeDefined();
    expect(result.success).toBe(false);

    const row = await prisma.diagnosticsRun.findUnique({
      where: { id: result.diagnosticsRunId },
    });
    expect(row?.status).toBe("failed");
    expect(row?.summary).toMatchObject({ total: 1, passed: 0, failed: 1 });
  });

  it("persists completed run with started/completed timestamps and results", async () => {
    const { connectionId } = await seedUserAndConnection(prisma, "e2e-svc-anon@example.com");

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

    const result = await service.run(undefined, makeConn({ id: connectionId }), {
      connectionId,
      probes: ["chat-text"],
    });

    const row = await prisma.diagnosticsRun.findUnique({
      where: { id: result.diagnosticsRunId },
    });
    expect(row?.status).toBe("completed");
    expect(row?.startedAt).toBeInstanceOf(Date);
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(Array.isArray(row?.results)).toBe(true);
  });
});
