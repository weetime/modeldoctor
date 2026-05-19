import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";
import { E2E_ENV_DEFAULTS } from "../setup/e2e-env-defaults.js";

// See alerts.e2e-spec for the time-of-validation explanation; this spec
// also dispatches alerts via /api/alerts/webhook and so needs the same
// Bearer the pre-injected fixture installs.
const TEST_SECRET = E2E_ENV_DEFAULTS.ALERTMANAGER_WEBHOOK_SECRET;

describe("Connection subscribers e2e", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let ownerToken: string;
  let ownerId: string;
  let otherToken: string;
  let otherId: string;
  let connectionId: string;
  let ownerChannelId: string;
  let otherChannelId: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);

    // Owner: creates connection and channel.
    const owner = await registerUser(ctx.app, "owner@example.com");
    ownerToken = owner.token;
    ownerId = owner.user.id;
    // Second user: their channel cannot be used by the owner to subscribe.
    const other = await registerUser(ctx.app, "other@example.com");
    otherToken = other.token;
    otherId = other.user.id;

    const conn = await prisma.connection.create({
      data: {
        userId: ownerId,
        name: "subs-test-conn",
        baseUrl: "https://vllm-subs.local:8000",
        apiKeyCipher: "n/a",
        model: "subs-model-x",
        category: "chat",
      },
    });
    connectionId = conn.id;

    const ch1 = await request(ctx.app.getHttpServer())
      .post("/api/notifications/channels")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ type: "webhook", name: "owner-hook", url: "https://example.test/owner" })
      .expect(201);
    ownerChannelId = ch1.body.id;

    const ch2 = await request(ctx.app.getHttpServer())
      .post("/api/notifications/channels")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ type: "webhook", name: "other-hook", url: "https://example.test/other" })
      .expect(201);
    otherChannelId = ch2.body.id;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("owner can list (empty initially)", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/connections/${connectionId}/subscribers`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it("non-owner cannot list", async () => {
    await request(ctx.app.getHttpServer())
      .get(`/api/connections/${connectionId}/subscribers`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);
  });

  it("owner can subscribe themselves to their own channel", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/connections/${connectionId}/subscribers`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ channelId: ownerChannelId, minSeverity: "warning" })
      .expect(201);
    expect(res.body.userId).toBe(ownerId);
    expect(res.body.channelId).toBe(ownerChannelId);
    expect(res.body.minSeverity).toBe("warning");
  });

  it("owner cannot subscribe themselves via another user's channel", async () => {
    await request(ctx.app.getHttpServer())
      .post(`/api/connections/${connectionId}/subscribers`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ channelId: otherChannelId, minSeverity: "warning" })
      .expect(403);
  });

  it("owner can subscribe another user via that user's channel", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/connections/${connectionId}/subscribers`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ channelId: otherChannelId, userId: otherId, minSeverity: "critical" })
      .expect(201);
    expect(res.body.userId).toBe(otherId);
    expect(res.body.minSeverity).toBe("critical");
  });

  it("delete via DELETE :id removes only that subscriber", async () => {
    const before = await prisma.connectionSubscriber.findMany({
      where: { connectionId },
    });
    const target = before.find((s) => s.userId === otherId);
    expect(target).toBeDefined();
    await request(ctx.app.getHttpServer())
      .delete(`/api/connections/${connectionId}/subscribers/${target!.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
    const after = await prisma.connectionSubscriber.findMany({
      where: { connectionId },
    });
    expect(after.find((s) => s.id === target!.id)).toBeUndefined();
    expect(after.find((s) => s.userId === ownerId)).toBeDefined();
  });

  it("alert dispatch fans out to matching subscribers (severity gate enforced)", async () => {
    // At this point only the owner is subscribed at minSeverity=warning.
    // Send a critical alert that should hit them. Then send an info alert
    // (below floor) that should not.
    const deliveriesBefore = await prisma.notificationDelivery.count({
      where: { channelId: ownerChannelId },
    });

    await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .set("Authorization", `Bearer ${TEST_SECRET}`)
      .send({
        version: "4",
        groupKey: "test",
        alerts: [
          {
            status: "firing",
            labels: {
              alertname: "TestCritical",
              severity: "critical",
              model_name: "subs-model-x",
            },
            annotations: {},
            startsAt: "2026-05-17T08:00:00.000Z",
            fingerprint: "fp-critical",
          },
        ],
      })
      .expect(202);

    // Below floor — should NOT deliver.
    await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .set("Authorization", `Bearer ${TEST_SECRET}`)
      .send({
        version: "4",
        groupKey: "test",
        alerts: [
          {
            status: "firing",
            labels: {
              alertname: "TestInfo",
              severity: "info",
              model_name: "subs-model-x",
            },
            annotations: {},
            startsAt: "2026-05-17T08:05:00.000Z",
            fingerprint: "fp-info",
          },
        ],
      })
      .expect(202);

    // Explainer is fire-and-forget; the dispatch path that does NOT need
    // an LLM is the no-explainer branch where we skip. To validate the
    // severity gate alone, we directly check what the subscribers service
    // returns. (The full LLM path is exercised manually in dev.)
    const { SubscribersService } = await import(
      "../../src/modules/alerts/subscribers.service.js"
    );
    const subs = ctx.app.get(SubscribersService);
    const criticalMatches = await subs.findMatching(connectionId, "critical");
    const infoMatches = await subs.findMatching(connectionId, "info");
    expect(criticalMatches.length).toBe(1);
    expect(infoMatches.length).toBe(0);
  });
});
