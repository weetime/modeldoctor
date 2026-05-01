import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { RunController } from "./run.controller.js";
import { RunRepository } from "./run.repository.js";
import { RunService } from "./run.service.js";

describe("RunController", () => {
  let controller: RunController;
  let prisma: PrismaService;

  beforeEach(async () => {
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
              return undefined;
            },
          },
        },
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

    // Owner's runs
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
    // Stranger's run — must NOT show up in owner's listing
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
});
