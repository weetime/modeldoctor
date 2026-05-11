import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import * as adapters from "./adapters/index.js";
import { ChannelsService } from "./channels.service.js";
import { DispatcherService } from "./dispatcher.service.js";

const TEST_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

describe("DispatcherService", () => {
  let svc: DispatcherService;
  let channels: ChannelsService;
  let prisma: PrismaService;
  let userId: string;
  let channelId: string;
  // biome-ignore lint/suspicious/noExplicitAny: spy generic on a re-exported fn
  let dispatchSpy: any;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        DispatcherService,
        ChannelsService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "CONNECTION_API_KEY_ENCRYPTION_KEY") return TEST_KEY_B64;
              if (key === "DATABASE_URL") return process.env.DATABASE_URL;
              return undefined;
            },
          },
        },
      ],
    }).compile();
    svc = mod.get(DispatcherService);
    channels = mod.get(ChannelsService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    const u = await prisma.user.create({
      data: { email: `disp-${Date.now()}-${Math.random()}@e.com`, passwordHash: "x" },
    });
    userId = u.id;
    const ch = await channels.create(userId, {
      type: "webhook",
      name: "disp-test",
      url: "https://example.test/hook",
    });
    channelId = ch.id;
    dispatchSpy = vi.spyOn(adapters, "dispatchToChannel");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:00:00.000Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    dispatchSpy.mockRestore();
    await prisma.notificationDelivery.deleteMany({ where: { channel: { userId } } });
    await prisma.notificationChannel.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("marks delivery sent on success", async () => {
    const delivery = await prisma.notificationDelivery.create({
      data: { channelId, eventType: "x", payload: {} },
    });
    dispatchSpy.mockResolvedValue(undefined as never);

    await svc.tick();

    const reloaded = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(reloaded.status).toBe("sent");
    expect(reloaded.sentAt).toBeInstanceOf(Date);
  });

  it("schedules first retry +30s on attempt 1 failure", async () => {
    const delivery = await prisma.notificationDelivery.create({
      data: { channelId, eventType: "x", payload: {} },
    });
    dispatchSpy.mockRejectedValue(new Error("boom"));

    await svc.tick();

    const reloaded = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(reloaded.status).toBe("failed");
    expect(reloaded.attempts).toBe(1);
    expect(reloaded.lastError).toBe("boom");
    expect(reloaded.nextRetryAt?.toISOString()).toBe("2026-05-11T00:00:30.000Z");
  });

  it("schedules +5min retry on attempt 2 failure", async () => {
    const delivery = await prisma.notificationDelivery.create({
      data: {
        channelId,
        eventType: "x",
        payload: {},
        status: "failed",
        attempts: 1,
        nextRetryAt: new Date("2026-05-10T23:00:00.000Z"),
      },
    });
    dispatchSpy.mockRejectedValue(new Error("boom"));

    await svc.tick();

    const reloaded = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(reloaded.attempts).toBe(2);
    expect(reloaded.nextRetryAt?.toISOString()).toBe("2026-05-11T00:05:00.000Z");
  });

  it("marks terminal failed (nextRetryAt=null) on attempt 3 failure", async () => {
    const delivery = await prisma.notificationDelivery.create({
      data: {
        channelId,
        eventType: "x",
        payload: {},
        status: "failed",
        attempts: 2,
        nextRetryAt: new Date("2026-05-10T23:00:00.000Z"),
      },
    });
    dispatchSpy.mockRejectedValue(new Error("boom"));

    await svc.tick();

    const reloaded = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(reloaded.attempts).toBe(3);
    expect(reloaded.nextRetryAt).toBeNull();
  });

  it("skips deliveries whose nextRetryAt is still in the future", async () => {
    await prisma.notificationDelivery.create({
      data: {
        channelId,
        eventType: "x",
        payload: {},
        status: "failed",
        attempts: 1,
        nextRetryAt: new Date("2026-05-11T00:05:00.000Z"), // 5min future
      },
    });
    dispatchSpy.mockResolvedValue(undefined as never);

    await svc.tick();

    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
