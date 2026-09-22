import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startPostgres,
  type TestDatabase,
} from "../../../../../test/helpers/postgres-container.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import { DiscoveredModelsService } from "../discovered-models.service.js";

let db: TestDatabase;
let prisma: PrismaClient;
let userId: string;
let otherUserId: string;
let modelId: string;
let revId: string;

const runner = {
  enqueue: vi.fn(async () => "run1"),
  cancel: vi.fn(async () => {}),
};
const connections = { update: vi.fn(async () => {}) };
const sources = { getDecrypted: vi.fn() };
const factory = { create: vi.fn() };

function svc() {
  return new DiscoveredModelsService(
    prisma as unknown as PrismaService,
    runner as never,
    connections as never,
    sources as never,
    factory as never,
  );
}

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  userId = (
    await prisma.user.create({
      data: { email: `dm-${Date.now()}@t`, passwordHash: "x", roles: [] },
    })
  ).id;
  otherUserId = (
    await prisma.user.create({
      data: { email: `dm2-${Date.now()}@t`, passwordHash: "x", roles: [] },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.platformSource.deleteMany({});
  // Connection isn't cascade-deleted by platformSource (DiscoveredModel -> Connection
  // is onDelete: SetNull, not the reverse), and Connection has a @@unique([userId, name])
  // constraint — without this, the 2nd+ test's fixture insert collides on (userId, "c").
  await prisma.connection.deleteMany({ where: { userId } });
  const s = await prisma.platformSource.create({
    data: { userId, name: "gs", baseUrl: "http://gs", apiKeyCipher: "x" },
  });
  const c = await prisma.connection.create({
    data: {
      userId,
      name: "c",
      baseUrl: "http://gs/v1",
      apiKeyCipher: "",
      model: "qwen",
      category: "chat",
    },
  });
  const dm = await prisma.discoveredModel.create({
    data: {
      sourceId: s.id,
      externalId: "7",
      name: "qwen",
      categories: ["llm"],
      status: "new",
      routeName: "qwen",
      connectionId: c.id,
    },
  });
  modelId = dm.id;
  const r1 = await prisma.deploymentRevision.create({
    data: {
      discoveredModelId: modelId,
      fingerprint: "a",
      snapshot: { backend_version: "0.10.1" },
      firstSeenAt: new Date("2026-09-20T00:00:00Z"),
      readyAt: new Date("2026-09-20T00:01:00Z"),
    },
  });
  const r2 = await prisma.deploymentRevision.create({
    data: {
      discoveredModelId: modelId,
      fingerprint: "b",
      snapshot: { backend_version: "0.11.0" },
      firstSeenAt: new Date("2026-09-21T00:00:00Z"),
      readyAt: new Date("2026-09-21T00:01:00Z"),
    },
  });
  revId = r2.id;
  await prisma.discoveredModel.update({
    where: { id: modelId },
    data: { currentRevisionId: r2.id },
  });
  void r1;
});

describe("DiscoveredModelsService", () => {
  it("list is owner-scoped", async () => {
    expect(await svc().list(userId, {})).toHaveLength(1);
    expect(await svc().list(otherUserId, {})).toHaveLength(0);
  });

  it("get 404 for other user", async () => {
    await expect(svc().get(otherUserId, modelId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("enabling requires evaluation when quality_gate step selected", async () => {
    await expect(
      svc().update(userId, modelId, { automationEnabled: true, benchmarkTemplateId: "t" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enabling requires template when benchmark step selected", async () => {
    await expect(
      svc().update(userId, modelId, { automationEnabled: true, steps: ["benchmark"] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enabling unroutable model is rejected", async () => {
    await prisma.discoveredModel.update({ where: { id: modelId }, data: { status: "unroutable" } });
    await expect(
      svc().update(userId, modelId, { automationEnabled: true, steps: ["diagnostics"] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enabling sets active, default gateConfig, schedule time and enqueues enable run", async () => {
    const now = Date.now();
    const out = await svc().update(userId, modelId, {
      automationEnabled: true,
      evaluationId: "e1",
      benchmarkTemplateId: "t1",
      schedule: "daily",
    });
    expect(out).toMatchObject({
      automationEnabled: true,
      status: "active",
      gateConfig: { passRateMin: 0.9 },
      schedule: "daily",
    });
    expect(new Date(out.nextScheduledAt!).getTime()).toBeGreaterThanOrEqual(
      now + 24 * 3600 * 1000 - 5000,
    );
    expect(runner.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ discoveredModelId: modelId, revisionId: revId, trigger: "enable" }),
    );
  });

  it("disabling cancels active runs", async () => {
    await prisma.discoveredModel.update({
      where: { id: modelId },
      data: { automationEnabled: true, steps: ["diagnostics"] },
    });
    const run = await prisma.automationRun.create({
      data: {
        discoveredModelId: modelId,
        sourceId: (await prisma.platformSource.findFirstOrThrow()).id,
        revisionId: revId,
        trigger: "manual",
        triggerKey: "k",
        status: "running",
      },
    });
    await svc().update(userId, modelId, { automationEnabled: false });
    expect(runner.cancel).toHaveBeenCalledWith(run.id, null);
  });

  it("routeName override updates connection model", async () => {
    const out = await svc().update(userId, modelId, { routeName: "manual-route" });
    expect(out).toMatchObject({ routeName: "manual-route", routeOverride: true });
    expect(connections.update).toHaveBeenCalledWith(userId, expect.any(String), {
      model: "manual-route",
    });
  });

  it("listRevisions returns newest first with diff vs previous", async () => {
    const revs = await svc().listRevisions(userId, modelId);
    expect(revs.map((r) => r.fingerprint)).toEqual(["b", "a"]);
    expect(revs[0].diff).toEqual([{ field: "backend_version", before: "0.10.1", after: "0.11.0" }]);
    expect(revs[1].diff).toEqual([{ field: "backend_version", before: null, after: "0.10.1" }]);
  });

  it("runNow requires automation config and current revision", async () => {
    await expect(svc().runNow(userId, modelId)).rejects.toBeInstanceOf(BadRequestException);
  });
});
