import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startPostgres,
  type TestDatabase,
} from "../../../../../test/helpers/postgres-container.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import type { GpustackModel, GpustackRoute } from "../../gpustack/types.js";
import { SourceSyncService } from "../source-sync.service.js";

let db: TestDatabase;
let prisma: PrismaClient;
let userId: string;
let sourceId: string;

let models: GpustackModel[];
let routes: GpustackRoute[];
const client = {
  listModels: vi.fn(async () => models),
  listRoutes: vi.fn(async () => routes),
  listInstances: vi.fn(async () => []),
};
const connections = {
  create: vi.fn(async (uid: string, input: { name: string; baseUrl: string; model: string }) => {
    const c = await prisma.connection.create({
      data: {
        userId: uid,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKeyCipher: "",
        model: input.model,
        category: "chat",
      },
    });
    return { id: c.id };
  }),
  update: vi.fn(async (_uid: string, id: string, input: { enabled?: boolean; model?: string }) => {
    await prisma.connection.update({ where: { id }, data: input });
  }),
};
interface DecryptedSource {
  id: string;
  userId: string;
  baseUrl: string;
  apiKey: string;
  clusterId: string | null;
  enabled: boolean;
}
const sources = {
  getDecrypted: vi.fn(
    async (): Promise<DecryptedSource> => ({
      id: sourceId,
      userId,
      baseUrl: "http://gs",
      apiKey: "k",
      clusterId: null,
      enabled: true,
    }),
  ),
};
const factory = { create: vi.fn(async () => client) };

function svc() {
  return new SourceSyncService(
    prisma as unknown as PrismaService,
    sources as never,
    factory as never,
    connections as never,
  );
}

const qwen = (over: Partial<GpustackModel> = {}): GpustackModel => ({
  id: 7,
  name: "qwen",
  categories: ["llm"],
  cluster_id: 1,
  replicas: 1,
  ready_replicas: 0,
  backend: "vLLM",
  backend_version: "0.10.1",
  backend_parameters: ["--max-num-seqs=256"],
  source: "huggingface",
  huggingface_repo_id: "Qwen/Qwen3-8B",
  ...over,
});

const other = (over: Partial<GpustackModel> = {}): GpustackModel => ({
  id: 8,
  name: "other",
  categories: ["llm"],
  cluster_id: 1,
  replicas: 1,
  ready_replicas: 0,
  backend: "vLLM",
  backend_version: "0.10.1",
  backend_parameters: ["--max-num-seqs=256"],
  source: "huggingface",
  huggingface_repo_id: "Other/Other",
  ...over,
});

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const u = await prisma.user.create({
    data: { email: `sync-${Date.now()}@t`, passwordHash: "x", roles: [] },
  });
  userId = u.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

beforeEach(async () => {
  await prisma.platformSource.deleteMany({});
  await prisma.connection.deleteMany({});
  const s = await prisma.platformSource.create({
    data: { userId, name: "gs", baseUrl: "http://gs", apiKeyCipher: "x" },
  });
  sourceId = s.id;
  models = [qwen()];
  routes = [{ id: 1, name: "qwen", created_model_id: 7, targets: 1 }];
  vi.clearAllMocks();
});

describe("SourceSyncService.reconcile", () => {
  it("discovers model, creates connection against the source's host root and first revision", async () => {
    const r = await svc().reconcile(sourceId);
    expect(r).toMatchObject({ models: 1, revisionsCreated: 1, readyRevisions: [], removed: 0 });
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm).toMatchObject({ externalId: "7", name: "qwen", status: "new", routeName: "qwen" });
    expect(connections.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        baseUrl: "http://gs",
        model: "qwen",
        category: "chat",
        serverKind: "vllm",
        tokenizerHfId: "Qwen/Qwen3-8B",
        apiKey: "k",
      }),
    );
    expect(dm.connectionId).not.toBeNull();
    expect(dm.currentRevisionId).not.toBeNull();
  });

  it("is idempotent: second run creates nothing new", async () => {
    await svc().reconcile(sourceId);
    const r2 = await svc().reconcile(sourceId);
    expect(r2.revisionsCreated).toBe(0);
    expect(connections.create).toHaveBeenCalledTimes(1);
    expect(await prisma.deploymentRevision.count()).toBe(1);
  });

  it("replica change does not create revision; parameter change does", async () => {
    await svc().reconcile(sourceId);
    models = [qwen({ replicas: 3 })];
    expect((await svc().reconcile(sourceId)).revisionsCreated).toBe(0);
    models = [qwen({ backend_parameters: ["--max-num-seqs=512"] })];
    expect((await svc().reconcile(sourceId)).revisionsCreated).toBe(1);
  });

  it("marks readyAt once and reports it exactly once, notifying listener", async () => {
    const s = svc();
    const listener = vi.fn(async () => {});
    s.setReadyListener(listener);
    await s.reconcile(sourceId);
    models = [qwen({ ready_replicas: 1 })];
    const r = await s.reconcile(sourceId);
    expect(r.readyRevisions).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((await s.reconcile(sourceId)).readyRevisions).toHaveLength(0);
  });

  it("no dedicated route -> unroutable, no connection", async () => {
    routes = [{ id: 1, name: "shared", created_model_id: 7, targets: 2 }];
    await svc().reconcile(sourceId);
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm.status).toBe("unroutable");
    expect(dm.connectionId).toBeNull();
    expect(connections.create).not.toHaveBeenCalled();
  });

  it("model missing from a non-empty list -> removed + connection disabled; reappears -> restored", async () => {
    // Non-empty list (a second model "other" stays present throughout) so
    // this exercises the "specific model dropped from a live list" path,
    // distinct from the guarded "list came back fully empty" path below.
    routes = [
      { id: 1, name: "qwen", created_model_id: 7, targets: 1 },
      { id: 2, name: "other", created_model_id: 8, targets: 1 },
    ];
    models = [qwen(), other()];
    await svc().reconcile(sourceId);
    models = [other()];
    expect((await svc().reconcile(sourceId)).removed).toBe(1);
    const dm = await prisma.discoveredModel.findFirstOrThrow({
      where: { sourceId, externalId: "7" },
    });
    expect(dm.status).toBe("removed");
    expect(connections.update).toHaveBeenCalledWith(userId, dm.connectionId, { enabled: false });
    models = [qwen(), other()];
    await svc().reconcile(sourceId);
    const dm2 = await prisma.discoveredModel.findFirstOrThrow({
      where: { sourceId, externalId: "7" },
    });
    expect(dm2.status).toBe("new");
    expect(connections.update).toHaveBeenLastCalledWith(userId, dm.connectionId, { enabled: true });
  });

  it("route removed -> unroutable disables Connection; route restored -> re-enabled", async () => {
    const r1 = await svc().reconcile(sourceId);
    expect(r1).toMatchObject({ revisionsCreated: 1, removed: 0 });
    const dm1 = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm1.connectionId).not.toBeNull();
    expect(dm1.status).toBe("new");

    // Route deleted (or became multi-target) — GPUStack may reuse "qwen"
    // for a different model, so the stale Connection must be disabled.
    routes = [];
    const r2 = await svc().reconcile(sourceId);
    expect(r2.removed).toBe(0);
    const dm2 = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm2.status).toBe("unroutable");
    expect(dm2.connectionId).toBe(dm1.connectionId);
    expect(connections.update).toHaveBeenCalledWith(userId, dm1.connectionId, {
      enabled: false,
    });

    // A second reconcile while still unroutable must not re-issue the
    // disable call (idempotent transition, not a per-tick side effect).
    connections.update.mockClear();
    await svc().reconcile(sourceId);
    expect(connections.update).not.toHaveBeenCalled();

    // Route reappears -> restored, Connection re-enabled with the model set.
    routes = [{ id: 1, name: "qwen", created_model_id: 7, targets: 1 }];
    await svc().reconcile(sourceId);
    const dm3 = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm3.status).toBe("new");
    expect(dm3.connectionId).toBe(dm1.connectionId);
    expect(connections.update).toHaveBeenLastCalledWith(userId, dm1.connectionId, {
      model: "qwen",
      enabled: true,
    });
    expect(connections.create).toHaveBeenCalledTimes(1);
  });

  it("empty model list from a known source refuses mass-removal and records lastSyncError", async () => {
    await svc().reconcile(sourceId);
    const before = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(before.connectionId).not.toBeNull();

    models = [];
    const r = await svc().reconcile(sourceId);
    expect(r.removed).toBe(0);
    expect(connections.update).not.toHaveBeenCalled();

    const after = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(after.status).toBe(before.status);
    expect(after.connectionId).toBe(before.connectionId);

    const s = await prisma.platformSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(s.lastSyncError).toMatch(/refusing to mass-remove/);
    expect(s.lastSyncAt).not.toBeNull();
  });

  it("list failure records lastSyncError and leaves models untouched", async () => {
    await svc().reconcile(sourceId);
    client.listModels.mockRejectedValueOnce(new Error("HTTP 502"));
    await expect(svc().reconcile(sourceId)).rejects.toThrow("HTTP 502");
    const s = await prisma.platformSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(s.lastSyncError).toContain("HTTP 502");
    expect((await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } })).status).toBe(
      "new",
    );
  });

  it("clusterId filter skips other clusters", async () => {
    sources.getDecrypted.mockResolvedValueOnce({
      id: sourceId,
      userId,
      baseUrl: "http://gs",
      apiKey: "k",
      clusterId: "2",
      enabled: true,
    });
    const r = await svc().reconcile(sourceId);
    expect(r.models).toBe(0);
  });

  // --- Critical 1: a Connection name collision must not silently kill the source ---

  it("colliding connection name is disambiguated instead of aborting the whole reconcile", async () => {
    // Exactly the delete-and-re-add path: the previous source's Connection
    // survives (DiscoveredModel -> Connection is SetNull, not Cascade), so
    // the name `gpustack/qwen` is already taken for this user.
    await prisma.connection.create({
      data: {
        userId,
        name: "gpustack/qwen",
        baseUrl: "http://old",
        apiKeyCipher: "",
        model: "qwen",
        category: "chat",
      },
    });

    const r = await svc().reconcile(sourceId);

    expect(r).toMatchObject({ models: 1, failed: 0, revisionsCreated: 1 });
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm.status).toBe("new");
    expect(dm.connectionId).not.toBeNull();
    const conn = await prisma.connection.findUniqueOrThrow({ where: { id: dm.connectionId! } });
    expect(conn.name).not.toBe("gpustack/qwen");
    expect(conn.name).toContain("gpustack/qwen");
    // …and the source still looks healthy, because nothing actually failed.
    const s = await prisma.platformSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(s.lastSyncError).toBeNull();
  });

  it("a model that throws is isolated: the rest of the source syncs and lastSyncError is set", async () => {
    routes = [
      { id: 1, name: "qwen", created_model_id: 7, targets: 1 },
      { id: 2, name: "other", created_model_id: 8, targets: 1 },
    ];
    models = [qwen(), other()];
    // First model's connection creation blows up in a way retrying can't fix.
    connections.create.mockRejectedValueOnce(new Error("boom"));

    const r = await svc().reconcile(sourceId);

    expect(r.failed).toBe(1);
    // The healthy model still got fully processed.
    const ok = await prisma.discoveredModel.findFirstOrThrow({
      where: { sourceId, externalId: "8" },
    });
    expect(ok.connectionId).not.toBeNull();
    expect(ok.currentRevisionId).not.toBeNull();
    // The broken one was NOT mistaken for "vanished from GPUStack".
    expect(r.removed).toBe(0);
    expect(
      (await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId, externalId: "7" } }))
        .status,
    ).not.toBe("removed");
    // …and the UI is no longer green.
    const s = await prisma.platformSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(s.lastSyncError).toMatch(/1 model\(s\) failed to sync: qwen: boom/);
  });

  it("a non-client (DB) failure records lastSyncError too", async () => {
    await svc().reconcile(sourceId);
    await prisma.platformSource.update({
      where: { id: sourceId },
      data: { lastSyncError: null },
    });
    const s = svc();
    // markRemoved's connection disable is the non-client failure here.
    models = [other()];
    routes = [{ id: 2, name: "other", created_model_id: 8, targets: 1 }];
    connections.update.mockRejectedValueOnce(new Error("db down"));
    await expect(s.reconcile(sourceId)).rejects.toThrow("db down");
    const src = await prisma.platformSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(src.lastSyncError).toContain("db down");
  });

  // --- Important 2: a removed model's in-flight run goes through the runner ---

  it("markRemoved cancels the in-flight run through the runner, not a raw updateMany", async () => {
    routes = [
      { id: 1, name: "qwen", created_model_id: 7, targets: 1 },
      { id: 2, name: "other", created_model_id: 8, targets: 1 },
    ];
    models = [qwen(), other()];
    const s = svc();
    const cancelRuns = vi.fn(async (discoveredModelId: string, reason: string) => {
      await prisma.automationRun.updateMany({
        where: { discoveredModelId, status: { in: ["pending", "running"] } },
        data: { status: "cancelled", finishedAt: new Date(), summary: { steps: [], reason } },
      });
    });
    s.setCancelRunsListener(cancelRuns);
    await s.reconcile(sourceId);

    const dm = await prisma.discoveredModel.findFirstOrThrow({
      where: { sourceId, externalId: "7" },
    });
    const run = await prisma.automationRun.create({
      data: {
        discoveredModelId: dm.id,
        sourceId,
        revisionId: dm.currentRevisionId!,
        trigger: "manual",
        triggerKey: `manual:${Date.now()}`,
        status: "running",
        benchmarkId: "bench-1",
      },
    });

    models = [other()];
    expect((await s.reconcile(sourceId)).removed).toBe(1);

    // The cancellation went through the listener (which is the only path that
    // also cancels the child Benchmark / EvaluationRun), with the reason.
    expect(cancelRuns).toHaveBeenCalledWith(dm.id, "model removed from GPUStack");
    const after = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("cancelled");
  });

  it("routeOverride keeps user route even when auto-resolve differs", async () => {
    await svc().reconcile(sourceId);
    await prisma.discoveredModel.updateMany({
      where: { sourceId },
      data: { routeOverride: true, routeName: "manual" },
    });
    await svc().reconcile(sourceId);
    expect((await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } })).routeName).toBe(
      "manual",
    );
  });
});
