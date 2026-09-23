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

  it("rejects a baselineId owned by another user", async () => {
    const otherConn = await prisma.connection.create({
      data: {
        userId: otherUserId,
        name: `other-${Date.now()}-${Math.random()}`,
        baseUrl: "http://x",
        apiKeyCipher: "",
        model: "m",
        category: "chat",
      },
    });
    const otherBench = await prisma.benchmark.create({
      data: {
        userId: otherUserId,
        connectionId: otherConn.id,
        name: `secret-${Math.random()}`,
        scenario: "inference",
        tool: "guidellm",
        params: {},
        status: "completed",
        summaryMetrics: { tool: "guidellm", data: {} },
      },
    });
    const foreign = await prisma.baseline.create({
      data: { userId: otherUserId, benchmarkId: otherBench.id, name: "secret" },
    });

    await expect(svc().update(userId, modelId, { baselineId: foreign.id })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Nothing was written.
    expect(
      (await prisma.discoveredModel.findUniqueOrThrow({ where: { id: modelId } })).baselineId,
    ).toBeNull();
  });

  it("accepts a baselineId the acting user owns, and clearing it", async () => {
    const own = await prisma.benchmark.create({
      data: {
        userId,
        connectionId: (await prisma.connection.findFirstOrThrow({ where: { userId } })).id,
        name: `mine-${Math.random()}`,
        scenario: "inference",
        tool: "guidellm",
        params: {},
        status: "completed",
        summaryMetrics: { tool: "guidellm", data: {} },
      },
    });
    const bl = await prisma.baseline.create({
      data: { userId, benchmarkId: own.id, name: "mine" },
    });
    expect((await svc().update(userId, modelId, { baselineId: bl.id })).baselineId).toBe(bl.id);
    expect((await svc().update(userId, modelId, { baselineId: null })).baselineId).toBeNull();
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

  it("runNow rejects an enabled model with no current revision", async () => {
    await prisma.discoveredModel.update({
      where: { id: modelId },
      data: { automationEnabled: true, currentRevisionId: null },
    });
    await expect(svc().runNow(userId, modelId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("cancelRun 404s for another user's run and never calls runner.cancel", async () => {
    const run = await prisma.automationRun.create({
      data: {
        discoveredModelId: modelId,
        sourceId: (await prisma.platformSource.findFirstOrThrow()).id,
        revisionId: revId,
        trigger: "manual",
        triggerKey: "k-cancel-ownership",
        status: "pending",
      },
    });
    await expect(svc().cancelRun(otherUserId, run.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(runner.cancel).not.toHaveBeenCalled();
  });

  it("cancelRun calls runner.cancel for an owned run", async () => {
    const run = await prisma.automationRun.create({
      data: {
        discoveredModelId: modelId,
        sourceId: (await prisma.platformSource.findFirstOrThrow()).id,
        revisionId: revId,
        trigger: "manual",
        triggerKey: "k-cancel-success",
        status: "running",
      },
    });
    await svc().cancelRun(userId, run.id);
    expect(runner.cancel).toHaveBeenCalledWith(run.id, null);
  });

  it("listRoutes 404s for another user's source and never constructs the GPUStack client", async () => {
    const s = await prisma.platformSource.findFirstOrThrow();
    await expect(svc().listRoutes(otherUserId, s.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(factory.create).not.toHaveBeenCalled();
    expect(sources.getDecrypted).not.toHaveBeenCalled();
  });

  it("listRoutes maps GpustackRoute to GpustackRouteOption", async () => {
    const s = await prisma.platformSource.findFirstOrThrow();
    sources.getDecrypted.mockResolvedValue({
      id: s.id,
      userId,
      baseUrl: "http://gs",
      apiKey: "secret",
      clusterId: null,
      enabled: true,
    });
    const client = {
      listRoutes: vi.fn(async () => [
        { id: 1, name: "route-a", targets: 2, created_model_id: 42 },
        {
          id: 2,
          name: "route-b",
          effective_name: "route-b-eff",
          targets: 0,
          created_model_id: null,
        },
      ]),
    };
    factory.create.mockResolvedValue(client);

    const out = await svc().listRoutes(userId, s.id);

    expect(out).toEqual([
      { name: "route-a", targets: 2, createdModelId: "42" },
      { name: "route-b-eff", targets: 0, createdModelId: null },
    ]);
  });

  it("routeName:null restores automatic resolution without touching the Connection", async () => {
    await prisma.discoveredModel.update({ where: { id: modelId }, data: { routeOverride: true } });
    const out = await svc().update(userId, modelId, { routeName: null });
    expect(out.routeOverride).toBe(false);
    expect(connections.update).not.toHaveBeenCalled();
  });

  it("routeName override on a model with no connection succeeds without touching connections", async () => {
    await prisma.discoveredModel.update({ where: { id: modelId }, data: { connectionId: null } });
    const out = await svc().update(userId, modelId, { routeName: "manual-route-2" });
    expect(out).toMatchObject({ routeName: "manual-route-2", routeOverride: true });
    expect(connections.update).not.toHaveBeenCalled();
  });

  it("listRevisions with a single revision diffs against null", async () => {
    const s = await prisma.platformSource.findFirstOrThrow();
    const solo = await prisma.discoveredModel.create({
      data: { sourceId: s.id, externalId: "solo", name: "solo", categories: [], status: "new" },
    });
    await prisma.deploymentRevision.create({
      data: {
        discoveredModelId: solo.id,
        fingerprint: "solo-a",
        snapshot: { backend_version: "1.0.0" },
        firstSeenAt: new Date(),
        readyAt: new Date(),
      },
    });
    const revs = await svc().listRevisions(userId, solo.id);
    expect(revs).toHaveLength(1);
    expect(revs[0].diff).toEqual([{ field: "backend_version", before: null, after: "1.0.0" }]);
  });
});
