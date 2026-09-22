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

  it("model missing from list -> removed + connection disabled; reappears -> restored", async () => {
    await svc().reconcile(sourceId);
    models = [];
    expect((await svc().reconcile(sourceId)).removed).toBe(1);
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm.status).toBe("removed");
    expect(connections.update).toHaveBeenCalledWith(userId, dm.connectionId, { enabled: false });
    models = [qwen()];
    await svc().reconcile(sourceId);
    const dm2 = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm2.status).toBe("new");
    expect(connections.update).toHaveBeenLastCalledWith(userId, dm.connectionId, { enabled: true });
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
