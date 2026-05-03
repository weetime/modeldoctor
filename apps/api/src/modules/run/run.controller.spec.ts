import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { ConnectionService } from "../connection/connection.service.js";
import type { RunExecutionDriver } from "./drivers/execution-driver.interface.js";
import { RUN_DRIVER } from "./drivers/run-driver.token.js";
import { RunController } from "./run.controller.js";
import { RunRepository } from "./run.repository.js";
import { RunService } from "./run.service.js";

// Stub adapter registry to avoid pulling in the real (Phase 1 stubbed) adapters'
// buildCommand which throws "not implemented". The controller spec only needs
// to verify wiring; service-level adapter behavior is covered in run.service.spec.
vi.mock("@modeldoctor/tool-adapters", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    byTool: () => ({
      name: "guidellm",
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

const mockDriver: RunExecutionDriver = {
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
  BENCHMARK_CALLBACK_SECRET: "x".repeat(32),
  BENCHMARK_CALLBACK_URL: "http://api/",
  BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 1800,
  BENCHMARK_DRIVER: "subprocess",
};

describe("RunController", () => {
  let controller: RunController;
  let prisma: PrismaService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [RunController],
      providers: [
        RunService,
        RunRepository,
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
        { provide: RUN_DRIVER, useValue: mockDriver },
        { provide: ConnectionService, useValue: mockConnections },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(RunController);
    prisma = moduleRef.get(PrismaService);

    await prisma.baseline.deleteMany();
    await prisma.run.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 404 for unknown run", async () => {
    const user = { sub: "any-user", email: "x", roles: [] };
    await expect(controller.detail(user as never, "nope")).rejects.toThrow(/not found/i);
  });

  it("lists runs filtered by kind AND scoped to current user", async () => {
    const owner = await prisma.user.create({
      data: { email: "rc-owner@example.com", passwordHash: "x" },
    });
    const stranger = await prisma.user.create({
      data: { email: "rc-stranger@example.com", passwordHash: "x" },
    });

    await prisma.run.create({
      data: {
        userId: owner.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
      },
    });
    await prisma.run.create({
      data: {
        userId: owner.id,
        kind: "e2e",
        tool: "e2e",
        scenario: {},
        mode: "correctness",
        driverKind: "local",
        params: {},
      },
    });
    await prisma.run.create({
      data: {
        userId: stranger.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
      },
    });

    const ownerArg = { sub: owner.id, email: owner.email, roles: [] };
    const result = await controller.list(ownerArg as never, {
      kind: "benchmark",
      limit: 10,
      scope: "own",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("benchmark");
    expect(result.items[0].userId).toBe(owner.id);
  });

  it("does not leak internal fields in detail response", async () => {
    const owner = await prisma.user.create({
      data: { email: "rc-cipher@example.com", passwordHash: "x" },
    });
    const run = await prisma.run.create({
      data: {
        userId: owner.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
      },
    });

    const ownerArg = { sub: owner.id, email: owner.email, roles: [] };
    const dto = await controller.detail(ownerArg as never, run.id);
    expect(dto).not.toHaveProperty("apiKeyCipher");
  });

  it("returns 404 when reading another user's run", async () => {
    const owner = await prisma.user.create({
      data: { email: "rc-iso-owner@example.com", passwordHash: "x" },
    });
    const stranger = await prisma.user.create({
      data: { email: "rc-iso-stranger@example.com", passwordHash: "x" },
    });
    const run = await prisma.run.create({
      data: {
        userId: owner.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
      },
    });

    const strangerArg = {
      sub: stranger.id,
      email: stranger.email,
      roles: [],
    };
    await expect(controller.detail(strangerArg as never, run.id)).rejects.toThrow(/not found/i);
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
      kind: "benchmark",
      connectionId: conn.id,
      name: "rc-create-smoke",
      params: {},
    });
    expect(dto.status).toBe("submitted");
    expect(dto.driverHandle).toBe("subprocess:1234");
    expect(mockDriver.start).toHaveBeenCalledTimes(1);
  });

  it("cancel transitions a running run to canceled", async () => {
    const user = await prisma.user.create({
      data: { email: "rc-cancel@example.com", passwordHash: "x" },
    });
    const run = await prisma.run.create({
      data: {
        userId: user.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
        status: "running",
        driverHandle: "subprocess:9999",
      },
    });
    const userArg = { sub: user.id, email: user.email, roles: [] };
    const dto = await controller.cancel(userArg as never, run.id);
    expect(dto.status).toBe("canceled");
    expect(mockDriver.cancel).toHaveBeenCalledWith("subprocess:9999");
  });

  it("delete removes a terminal run", async () => {
    const user = await prisma.user.create({
      data: { email: "rc-delete@example.com", passwordHash: "x" },
    });
    const run = await prisma.run.create({
      data: {
        userId: user.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
        status: "completed",
      },
    });
    const userArg = { sub: user.id, email: user.email, roles: [] };
    await controller.delete(userArg as never, run.id);
    const after = await prisma.run.findUnique({ where: { id: run.id } });
    expect(after).toBeNull();
  });

  describe("admin authz", () => {
    it("rejects scope=all from non-admin caller (403)", async () => {
      const user = { sub: "u1", email: "u1@x", roles: [] };
      await expect(
        controller.list(user as never, { limit: 10, scope: "all" } as never),
      ).rejects.toThrow(/admin role required/i);
    });

    it("returns runs across all users when admin requests scope=all", async () => {
      const a = await prisma.user.create({ data: { email: "azz-1@x", passwordHash: "x" } });
      const b = await prisma.user.create({ data: { email: "azz-2@x", passwordHash: "x" } });
      for (const userId of [a.id, b.id]) {
        await prisma.run.create({
          data: {
            userId,
            kind: "benchmark",
            tool: "guidellm",
            scenario: {},
            mode: "fixed",
            driverKind: "local",
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
        await prisma.run.create({
          data: {
            userId,
            kind: "benchmark",
            tool: "guidellm",
            scenario: {},
            mode: "fixed",
            driverKind: "local",
            params: {},
          },
        });
      }
      const ua = { sub: a.id, email: a.email, roles: [] };
      const result = await controller.list(ua as never, { limit: 10 } as never);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].userId).toBe(a.id);
    });

    it("admin can read another user's run by id", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-5@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-6@x", passwordHash: "x" } });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      const dto = await controller.detail(adminArg as never, run.id);
      expect(dto.id).toBe(run.id);
      expect(dto.userId).toBe(owner.id);
    });

    it("non-admin gets 404 reading another user's run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-7@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-8@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.detail(strangerArg as never, run.id)).rejects.toThrow(/not found/i);
    });

    it("admin can cancel another user's running run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-9@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-10@x", passwordHash: "x" } });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "running",
          driverHandle: "subprocess:cancel-me",
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      const dto = await controller.cancel(adminArg as never, run.id);
      expect(dto.status).toBe("canceled");
    });

    it("non-admin gets 404 cancelling another user's run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-11@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-12@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "running",
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.cancel(strangerArg as never, run.id)).rejects.toThrow(/not found/i);
    });

    it("admin can delete another user's terminal run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-13@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-14@x", passwordHash: "x" } });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "completed",
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      await controller.delete(adminArg as never, run.id);
      const after = await prisma.run.findUnique({ where: { id: run.id } });
      expect(after).toBeNull();
    });

    it("non-admin gets 404 deleting another user's run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-15@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-16@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "completed",
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.delete(strangerArg as never, run.id)).rejects.toThrow(/not found/i);
    });
  });
});
