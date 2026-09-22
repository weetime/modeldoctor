import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startPostgres,
  type TestDatabase,
} from "../../../../../test/helpers/postgres-container.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import { AutomationRunnerService } from "../automation-runner.service.js";

let db: TestDatabase;
let prisma: PrismaClient;
let userId: string;
let sourceId: string;
let connId: string;
let modelId: string;
let revId: string;
let evaluationId: string;
let templateId: string;

const deps = {
  connections: { getOwnedDecrypted: vi.fn(async () => ({ id: "c" })) },
  diagnostics: { run: vi.fn(async () => ({ diagnosticsRunId: "d1", success: true, results: [] })) },
  runs: { create: vi.fn(), cancel: vi.fn(async () => {}) },
  benchmarks: { create: vi.fn(), cancel: vi.fn(async () => {}) },
  templates: {
    findByIdOrNull: vi.fn(async () => ({
      id: templateId,
      scenario: "inference",
      tool: "guidellm",
      config: { a: 1 },
    })),
  },
  baselines: { create: vi.fn() },
  notify: { emit: vi.fn(async () => {}) },
  sync: { setReadyListener: vi.fn() },
};

function svc() {
  return new AutomationRunnerService(
    prisma as unknown as PrismaService,
    deps.connections as never,
    deps.diagnostics as never,
    deps.runs as never,
    deps.benchmarks as never,
    deps.templates as never,
    deps.baselines as never,
    deps.notify as never,
    deps.sync as never,
  );
}

const summary = (tps: number) => ({
  tool: "guidellm",
  data: { outputTokensPerSecond: { mean: tps }, ttft: { p95: 100 }, itl: { p95: 20 } },
});

async function tickUntilDone(s: AutomationRunnerService, runId: string, max = 10) {
  for (let i = 0; i < max; i++) {
    await prisma.automationRun.updateMany({ where: { id: runId }, data: { lockedUntil: null } });
    await s.tick();
    const r = await prisma.automationRun.findUniqueOrThrow({ where: { id: runId } });
    if (r.status === "completed" || r.status === "cancelled") return r;
  }
  throw new Error("run did not finish");
}

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const u = await prisma.user.create({
    data: { email: `auto-${Date.now()}@t`, passwordHash: "x", roles: [] },
  });
  userId = u.id;
  const ev = await prisma.evaluation.create({
    data: { userId, name: "smoke", samples: [], totalSamples: 0 },
  });
  evaluationId = ev.id;
  const tpl = await prisma.benchmarkTemplate.findFirstOrThrow({ where: { isOfficial: true } });
  templateId = tpl.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.platformSource.deleteMany({});
  const s = await prisma.platformSource.create({
    data: { userId, name: "gs", baseUrl: "http://gs", apiKeyCipher: "x" },
  });
  sourceId = s.id;
  // platformSource.deleteMany cascades away the previous DiscoveredModel row
  // but the Connection it pointed at (onDelete: SetNull, not Cascade) — plus
  // its EvaluationRun history (onDelete: Restrict on endpointAId) — survives
  // across tests. A fixed name "c" would collide with the prior test's row
  // on the (user_id, name) unique constraint, so give each test its own.
  const c = await prisma.connection.create({
    data: {
      userId,
      name: `c-${Date.now()}-${Math.random()}`,
      baseUrl: "http://gs/v1",
      apiKeyCipher: "",
      model: "qwen",
      category: "chat",
    },
  });
  connId = c.id;
  const dm = await prisma.discoveredModel.create({
    data: {
      sourceId,
      externalId: "7",
      name: "qwen",
      categories: ["llm"],
      status: "active",
      routeName: "qwen",
      connectionId: connId,
      automationEnabled: true,
      evaluationId,
      gateConfig: { passRateMin: 0.9 },
      benchmarkTemplateId: templateId,
    },
  });
  modelId = dm.id;
  const rev = await prisma.deploymentRevision.create({
    data: { discoveredModelId: modelId, fingerprint: "f1", snapshot: {}, readyAt: new Date() },
  });
  revId = rev.id;
  await prisma.discoveredModel.update({
    where: { id: modelId },
    data: { currentRevisionId: revId },
  });
  deps.runs.create.mockImplementation(async () => {
    const r = await prisma.evaluationRun.create({
      data: {
        userId,
        evaluationId,
        evaluationVersion: 1,
        evaluationSnapshot: {},
        endpointAId: connId,
        gateConfig: { passRateMin: 0.9 },
        status: "COMPLETED",
        gateResult: "PASSED",
        totalSamples: 0,
      },
    });
    return r;
  });
  deps.benchmarks.create.mockImplementation(async () =>
    prisma.benchmark.create({
      data: {
        userId,
        connectionId: connId,
        name: `b-${Math.random()}`,
        scenario: "inference",
        tool: "guidellm",
        params: {},
        status: "completed",
        summaryMetrics: summary(1000),
        templateId,
      },
    }),
  );
  deps.baselines.create.mockImplementation(
    async (_u: string, input: { benchmarkId: string; name: string }) =>
      prisma.baseline.create({
        data: { userId, benchmarkId: input.benchmarkId, name: input.name, templateId },
      }),
  );
});

describe("AutomationRunnerService", () => {
  it("enqueue is idempotent on triggerKey", async () => {
    const s = svc();
    const a = await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "revision",
      triggerKey: `revision:${revId}`,
    });
    const b = await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "revision",
      triggerKey: `revision:${revId}`,
    });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("full pipeline passes and establishes baseline on first run", async () => {
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:1",
    }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("passed");
    expect(deps.diagnostics.run).toHaveBeenCalledWith(userId, expect.anything(), {
      connectionId: connId,
      probes: ["chat-text"],
    });
    expect(deps.runs.create).toHaveBeenCalledWith(userId, {
      evaluationId,
      endpointAId: connId,
      gateConfig: { passRateMin: 0.9 },
    });
    expect(deps.benchmarks.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        scenario: "inference",
        tool: "guidellm",
        connectionId: connId,
        params: { a: 1 },
        templateId,
      }),
    );
    expect((r.summary as { baselineEstablished?: boolean }).baselineEstablished).toBe(true);
    expect(
      (await prisma.discoveredModel.findUniqueOrThrow({ where: { id: modelId } })).baselineId,
    ).not.toBeNull();
    expect(deps.notify.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "automation.passed", userId, connectionId: connId }),
    );
  });

  it("diagnostics failure stops pipeline with failed verdict", async () => {
    deps.diagnostics.run.mockResolvedValueOnce({
      diagnosticsRunId: "d2",
      success: false,
      results: [],
    });
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:2",
    }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("failed");
    expect(deps.runs.create).not.toHaveBeenCalled();
    expect(deps.notify.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "automation.failed" }),
    );
  });

  it("regression against baseline yields regressed", async () => {
    const s = svc();
    const first = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:3",
    }))!;
    await tickUntilDone(s, first);
    deps.benchmarks.create.mockImplementationOnce(async () =>
      prisma.benchmark.create({
        data: {
          userId,
          connectionId: connId,
          name: "slow",
          scenario: "inference",
          tool: "guidellm",
          params: {},
          status: "completed",
          summaryMetrics: summary(800),
          templateId,
        },
      }),
    );
    const second = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:4",
    }))!;
    const r = await tickUntilDone(s, second);
    expect(r.verdict).toBe("regressed");
  });

  it("schedule trigger only runs benchmark", async () => {
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "schedule",
      triggerKey: "schedule:x",
    }))!;
    await tickUntilDone(s, id);
    expect(deps.diagnostics.run).not.toHaveBeenCalled();
    expect(deps.runs.create).not.toHaveBeenCalled();
    expect(deps.benchmarks.create).toHaveBeenCalledTimes(1);
  });

  it("new revision supersedes running run of same model", async () => {
    const s = svc();
    const old = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:5",
    }))!;
    await prisma.automationRun.update({
      where: { id: old },
      data: { status: "running", currentStep: "benchmark", benchmarkId: "bx" },
    });
    const rev2 = await prisma.deploymentRevision.create({
      data: { discoveredModelId: modelId, fingerprint: "f2", snapshot: {}, readyAt: new Date() },
    });
    await s.enqueue({
      discoveredModelId: modelId,
      revisionId: rev2.id,
      trigger: "revision",
      triggerKey: `revision:${rev2.id}`,
    });
    const r = await prisma.automationRun.findUniqueOrThrow({ where: { id: old } });
    expect(r).toMatchObject({ status: "cancelled", verdict: "superseded" });
    expect(deps.benchmarks.cancel).toHaveBeenCalledWith("bx", userId);
  });

  it("only one running run per source", async () => {
    const s = svc();
    const dm2 = await prisma.discoveredModel.create({
      data: {
        sourceId,
        externalId: "8",
        name: "m2",
        status: "active",
        connectionId: null,
        automationEnabled: true,
        steps: ["benchmark"],
        benchmarkTemplateId: templateId,
      },
    });
    const rev2 = await prisma.deploymentRevision.create({
      data: { discoveredModelId: dm2.id, fingerprint: "g", snapshot: {} },
    });
    await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:6",
    });
    await s.enqueue({
      discoveredModelId: dm2.id,
      revisionId: rev2.id,
      trigger: "manual",
      triggerKey: "manual:7",
    });
    deps.runs.create.mockImplementationOnce(async () =>
      prisma.evaluationRun.create({
        data: {
          userId,
          evaluationId,
          evaluationVersion: 1,
          evaluationSnapshot: {},
          endpointAId: connId,
          gateConfig: {},
          status: "RUNNING",
          totalSamples: 0,
        },
      }),
    );
    await s.tick();
    await s.tick();
    expect(await prisma.automationRun.count({ where: { sourceId, status: "running" } })).toBe(1);
  });

  it("scanSchedules enqueues due models and advances nextScheduledAt", async () => {
    const now = new Date("2026-09-22T00:00:00Z");
    await prisma.discoveredModel.update({
      where: { id: modelId },
      data: { schedule: "daily", nextScheduledAt: new Date("2026-09-21T23:59:00Z") },
    });
    const n = await svc().scanSchedules(now);
    expect(n).toBe(1);
    const dm = await prisma.discoveredModel.findUniqueOrThrow({ where: { id: modelId } });
    expect(dm.nextScheduledAt?.toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(
      await prisma.automationRun.count({
        where: { discoveredModelId: modelId, trigger: "schedule" },
      }),
    ).toBe(1);
  });
});
