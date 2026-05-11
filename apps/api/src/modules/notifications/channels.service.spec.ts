import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { ChannelsService } from "./channels.service.js";

const TEST_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

describe("ChannelsService", () => {
  let svc: ChannelsService;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ChannelsService,
        PrismaService,
        { provide: ConfigService, useValue: { get: () => TEST_KEY_B64 } },
      ],
    }).compile();
    svc = mod.get(ChannelsService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    const u = await prisma.user.create({
      data: { email: `ch-${Date.now()}-${Math.random()}@e.com`, passwordHash: "x" },
    });
    userId = u.id;
  });

  afterEach(async () => {
    await prisma.notificationChannel.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("encrypts url on create and returns masked output", async () => {
    const out = await svc.create(userId, {
      type: "slack",
      name: "ops",
      url: "https://hooks.slack.com/services/AAA/BBB/CCC",
    });
    expect(out.urlMasked).toBe("https://hooks.slack.com/***");

    // Verify ciphertext at rest is the v1 AES-GCM format, NOT the plaintext URL.
    const row = await prisma.notificationChannel.findUniqueOrThrow({ where: { id: out.id } });
    const stored = (row.config as { url: string }).url;
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("hooks.slack.com");
  });

  it("resolveForDispatch decrypts to original url", async () => {
    const created = await svc.create(userId, {
      type: "webhook",
      name: "ops-hook",
      url: "https://example.test/abc",
    });
    const resolved = await svc.resolveForDispatch(created.id);
    expect(resolved).toEqual({ type: "webhook", url: "https://example.test/abc" });
  });

  it("masks generic webhook url to <scheme>://host/***", () => {
    expect(svc.maskUrl("https://example.test/path/secret")).toBe("https://example.test/***");
  });

  it("list returns channels scoped to user, newest first", async () => {
    const a = await svc.create(userId, { type: "slack", name: "A", url: "https://x.test/a" });
    // Sleep 5ms to ensure deterministic createdAt ordering.
    await new Promise((r) => setTimeout(r, 5));
    const b = await svc.create(userId, { type: "webhook", name: "B", url: "https://x.test/b" });
    const list = await svc.list(userId);
    expect(list.map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it("update reuses existing url when only name changes", async () => {
    const created = await svc.create(userId, {
      type: "slack",
      name: "old",
      url: "https://hooks.slack.com/services/X/Y/Z",
    });
    await svc.update(userId, created.id, { name: "renamed" });
    const resolved = await svc.resolveForDispatch(created.id);
    expect(resolved?.url).toBe("https://hooks.slack.com/services/X/Y/Z");
  });

  it("delete removes channel", async () => {
    const created = await svc.create(userId, {
      type: "slack",
      name: "doomed",
      url: "https://x.test/k",
    });
    await svc.delete(userId, created.id);
    expect(await prisma.notificationChannel.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("delete throws for other-user channel", async () => {
    const other = await prisma.user.create({
      data: { email: `other-${Date.now()}@e.com`, passwordHash: "x" },
    });
    const created = await svc.create(other.id, {
      type: "slack",
      name: "private",
      url: "https://x.test/p",
    });
    await expect(svc.delete(userId, created.id)).rejects.toThrow(/not found/i);
    await prisma.notificationChannel.delete({ where: { id: created.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});
