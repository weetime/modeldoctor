import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionController } from "./connection.controller.js";
import { ConnectionService } from "./connection.service.js";

describe("ConnectionController", () => {
  let controller: ConnectionController;
  let prisma: PrismaService;
  let userId: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        ConnectionService,
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

    controller = moduleRef.get(ConnectionController);
    prisma = moduleRef.get(PrismaService);

    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();
    const u = await prisma.user.create({
      data: { email: "cc@example.com", passwordHash: "x" },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("create + list round-trip via controller", async () => {
    const userArg = { sub: userId, email: "cc@example.com", roles: [] } as JwtPayload;
    const created = await controller.create(userArg, {
      name: "via-ctrl",
      baseUrl: "http://localhost:8000",
      apiType: "chat",
    });
    expect(created.id).toBeDefined();

    const listed = await controller.list(userArg);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(created.id);
  });

  it("detail throws 404 for unknown id", async () => {
    const userArg = { sub: userId, email: "cc@example.com", roles: [] } as JwtPayload;
    await expect(controller.detail(userArg, "nope")).rejects.toThrow(/not found/i);
  });
});
