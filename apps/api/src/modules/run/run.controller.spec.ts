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
              if (key === "DATABASE_URL") return process.env["DATABASE_URL"];
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

    await prisma.run.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 404 for unknown run", async () => {
    await expect(controller.detail("nope")).rejects.toThrow(/not found/i);
  });

  it("lists runs with kind filter", async () => {
    const u = await prisma.user.create({
      data: { email: "rc@example.com", passwordHash: "x" },
    });
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
    await prisma.run.create({
      data: {
        userId: u.id,
        kind: "e2e",
        tool: "e2e",
        scenario: {},
        mode: "correctness",
        driverKind: "local",
        params: {},
      },
    });

    const result = await controller.list({ kind: "benchmark", limit: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("benchmark");
  });
});
