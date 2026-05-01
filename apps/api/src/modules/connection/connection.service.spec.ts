import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionService } from "./connection.service.js";

describe("ConnectionService", () => {
  let service: ConnectionService;
  let prisma: PrismaService;
  let userId: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
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
    }).compile();
    service = moduleRef.get(ConnectionService);
    prisma = moduleRef.get(PrismaService);

    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();
    const u = await prisma.user.create({
      data: { email: "cs@example.com", passwordHash: "x" },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates and lists connections scoped to userId", async () => {
    const c = await service.create(userId, {
      name: "vLLM dev",
      baseUrl: "http://localhost:8000",
      apiType: "chat",
    });
    expect(c.id).toBeDefined();

    const list = await service.list(userId);
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe("vLLM dev");
  });

  it("deletes only when owned by user", async () => {
    const c = await service.create(userId, {
      name: "owned",
      baseUrl: "http://localhost:8000",
      apiType: "chat",
    });
    const otherUser = await prisma.user.create({
      data: { email: "other@example.com", passwordHash: "x" },
    });
    await expect(service.delete(otherUser.id, c.id)).rejects.toThrow();

    await service.delete(userId, c.id);
    const list = await service.list(userId);
    expect(list.items).toHaveLength(0);
  });
});
