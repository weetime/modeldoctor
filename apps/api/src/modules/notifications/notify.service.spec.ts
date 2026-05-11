import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { NotifyService } from "./notify.service.js";

describe("NotifyService", () => {
  let svc: NotifyService;
  let prisma: PrismaService;
  let userId: string;
  let channelA: string;
  let channelB: string;
  let channelC: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        NotifyService,
        PrismaService,
        { provide: ConfigService, useValue: { get: () => process.env.DATABASE_URL } },
      ],
    }).compile();
    svc = mod.get(NotifyService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    const u = await prisma.user.create({
      data: { email: `notify-${Date.now()}-${Math.random()}@e.com`, passwordHash: "x" },
    });
    userId = u.id;
    const ca = await prisma.notificationChannel.create({
      data: { userId, type: "slack", name: "ch-A", config: { url: "v1:x:x:x" } },
    });
    channelA = ca.id;
    const cb = await prisma.notificationChannel.create({
      data: { userId, type: "webhook", name: "ch-B", config: { url: "v1:y:y:y" } },
    });
    channelB = cb.id;
    const cc = await prisma.notificationChannel.create({
      data: { userId, type: "webhook", name: "ch-C", config: { url: "v1:z:z:z" } },
    });
    channelC = cc.id;
  });

  afterEach(async () => {
    await prisma.notificationDelivery.deleteMany({ where: { channel: { userId } } });
    await prisma.notificationChannel.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fans out to subscriptions matching eventType + matching/null connectionId", async () => {
    // A has no filter; B filters connection-a; C filters connection-b.
    await prisma.notificationSubscription.createMany({
      data: [
        { channelId: channelA, eventType: "benchmark.completed" },
        {
          channelId: channelB,
          eventType: "benchmark.completed",
          filter: { connectionId: "conn-a" },
        },
        {
          channelId: channelC,
          eventType: "benchmark.completed",
          filter: { connectionId: "conn-b" },
        },
      ],
    });

    await svc.emit({
      eventType: "benchmark.completed",
      userId,
      connectionId: "conn-a",
      payload: { name: "b-1" },
    });

    const deliveries = await prisma.notificationDelivery.findMany({
      where: { channel: { userId } },
    });
    expect(deliveries).toHaveLength(2);
    expect(new Set(deliveries.map((d) => d.channelId))).toEqual(new Set([channelA, channelB]));
    expect(deliveries.every((d) => d.status === "pending")).toBe(true);
  });

  it("no-op when no matching subscriptions", async () => {
    await svc.emit({
      eventType: "diagnostics.failed",
      userId,
      payload: { runId: "r1" },
    });
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { channel: { userId } },
    });
    expect(deliveries).toHaveLength(0);
  });

  it("scopes by userId — other-user subscriptions are not affected", async () => {
    const other = await prisma.user.create({
      data: { email: `oth-${Date.now()}@e.com`, passwordHash: "x" },
    });
    const otherCh = await prisma.notificationChannel.create({
      data: { userId: other.id, type: "slack", name: "oth", config: { url: "v1:o:o:o" } },
    });
    await prisma.notificationSubscription.create({
      data: { channelId: otherCh.id, eventType: "benchmark.completed" },
    });

    await svc.emit({ eventType: "benchmark.completed", userId, payload: {} });
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { channelId: otherCh.id },
    });
    expect(deliveries).toHaveLength(0);

    await prisma.notificationChannel.delete({ where: { id: otherCh.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});
