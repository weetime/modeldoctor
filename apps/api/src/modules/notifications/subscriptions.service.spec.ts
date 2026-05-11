import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { SubscriptionsService } from "./subscriptions.service.js";

describe("SubscriptionsService", () => {
  let svc: SubscriptionsService;
  let prisma: PrismaService;
  let userId: string;
  let channelId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        PrismaService,
        { provide: ConfigService, useValue: { get: () => process.env.DATABASE_URL } },
      ],
    }).compile();
    svc = mod.get(SubscriptionsService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    const u = await prisma.user.create({
      data: { email: `sub-${Date.now()}-${Math.random()}@e.com`, passwordHash: "x" },
    });
    userId = u.id;
    const ch = await prisma.notificationChannel.create({
      data: { userId, type: "slack", name: "test", config: { url: "v1:x:x:x" } },
    });
    channelId = ch.id;
  });

  afterEach(async () => {
    await prisma.notificationChannel.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("create persists eventType + optional filter.connectionId", async () => {
    const out = await svc.create(userId, {
      channelId,
      eventType: "benchmark.failed",
      connectionId: "conn-x",
    });
    expect(out.eventType).toBe("benchmark.failed");
    expect(out.connectionId).toBe("conn-x");
    expect(out.channelName).toBe("test");

    const persisted = await prisma.notificationSubscription.findUniqueOrThrow({
      where: { id: out.id },
    });
    expect((persisted.filter as { connectionId: string }).connectionId).toBe("conn-x");
  });

  it("create without connectionId stores null filter", async () => {
    const out = await svc.create(userId, {
      channelId,
      eventType: "diagnostics.failed",
    });
    expect(out.connectionId).toBeUndefined();
    const persisted = await prisma.notificationSubscription.findUniqueOrThrow({
      where: { id: out.id },
    });
    expect(persisted.filter).toBeNull();
  });

  it("create rejects when channel does not belong to user", async () => {
    const other = await prisma.user.create({
      data: { email: `other-${Date.now()}@e.com`, passwordHash: "x" },
    });
    const otherCh = await prisma.notificationChannel.create({
      data: { userId: other.id, type: "slack", name: "x", config: { url: "v1:y:y:y" } },
    });
    await expect(
      svc.create(userId, { channelId: otherCh.id, eventType: "benchmark.completed" }),
    ).rejects.toThrow(/not found/i);
    await prisma.notificationChannel.delete({ where: { id: otherCh.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("list returns subscriptions joined to channel name, scoped to user", async () => {
    await svc.create(userId, { channelId, eventType: "benchmark.completed" });
    const rows = await svc.list(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].channelName).toBe("test");
    expect(rows[0].eventType).toBe("benchmark.completed");
  });

  it("delete removes subscription; rejects for other-user", async () => {
    const sub = await svc.create(userId, { channelId, eventType: "diagnostics.failed" });
    await svc.delete(userId, sub.id);
    expect(await prisma.notificationSubscription.findUnique({ where: { id: sub.id } })).toBeNull();

    // Re-create + try to delete as other user.
    const sub2 = await svc.create(userId, { channelId, eventType: "diagnostics.failed" });
    const other = await prisma.user.create({
      data: { email: `other2-${Date.now()}@e.com`, passwordHash: "x" },
    });
    await expect(svc.delete(other.id, sub2.id)).rejects.toThrow(/not found/i);
    await prisma.user.delete({ where: { id: other.id } });
  });
});
