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
  it("discovers model, creates connection against /v1 and first revision", async () => {
    const r = await svc().reconcile(sourceId);
    expect(r).toMatchObject({ models: 1, revisionsCreated: 1, readyRevisions: [], removed: 0 });
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm).toMatchObject({ externalId: "7", name: "qwen", status: "new", routeName: "qwen" });
    expect(connections.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        baseUrl: "http://gs/v1",
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
