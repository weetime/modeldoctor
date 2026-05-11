import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Mock the SSRF guard so the test can target a non-resolvable hostname
// (example.test). Hoisted by vitest before AppModule imports.
vi.mock("../../src/modules/connection/discovery/ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
  PRIVATE_HOSTS: new Set<string>(),
}));

import request from "supertest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { DispatcherService } from "../../src/modules/notifications/dispatcher.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("Notifications e2e", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let dispatcher: DispatcherService;
  let token: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    dispatcher = ctx.app.get(DispatcherService);
    const u = await registerUser(ctx.app, "notify@example.com");
    token = u.token;
  }, 120_000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it("create channel + subscription + outbound fetch on dispatched delivery", async () => {
    // 1. Create channel.
    const channelRes = await request(ctx.app.getHttpServer())
      .post("/api/notifications/channels")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "webhook", name: "test-hook", url: "https://example.test/hook" })
      .expect(201);
    const channelId: string = channelRes.body.id;
    expect(channelRes.body.urlMasked).toBe("https://example.test/***");

    // 2. Create subscription.
    await request(ctx.app.getHttpServer())
      .post("/api/notifications/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({ channelId, eventType: "benchmark.completed" })
      .expect(201);

    // 3. Insert a delivery row directly (skip emitting from a benchmark to keep test deterministic).
    const delivery = await prisma.notificationDelivery.create({
      data: {
        channelId,
        eventType: "benchmark.completed",
        payload: { benchmarkId: "b1", name: "test-run", status: "completed" },
      },
    });

    // 4. Stub global fetch.
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    // 5. Trigger dispatcher.
    await dispatcher.tick();

    // 6. Verify outbound POST.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/hook");
    expect(init.method).toBe("POST");

    // 7. Verify delivery row marked sent.
    const reloaded = await prisma.notificationDelivery.findUnique({
      where: { id: delivery.id },
    });
    expect(reloaded?.status).toBe("sent");
  });

  it("test endpoint returns ok=false when channel does not exist", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/notifications/channels/does-not-exist/test")
      .set("Authorization", `Bearer ${token}`);
    // Controller raises BadRequest before creating the delivery row.
    expect([400, 404]).toContain(res.status);
  });
});
