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
let otherUserId: string;
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
  sync: { setReadyListener: vi.fn(), setCancelRunsListener: vi.fn() },
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
  otherUserId = (
    await prisma.user.create({
      data: { email: `auto-other-${Date.now()}@t`, passwordHash: "x", roles: [] },
    })
  ).id;
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

  it("revision trigger racing an in-flight benchmark create cancels the orphaned benchmark", async () => {
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:race",
    }))!;
    // Drive ticks until the run is sitting at the benchmark step, still running
    // (diagnostics + quality_gate resolve immediately against the default mocks).
    for (let i = 0; i < 10; i++) {
      const cur = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
      if (cur.currentStep === "benchmark" && cur.status === "running") break;
      await prisma.automationRun.updateMany({ where: { id }, data: { lockedUntil: null } });
      await s.tick();
    }
    const before = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
    expect(before.currentStep).toBe("benchmark");
    expect(before.benchmarkId).toBeNull();

    // Make the next benchmarks.create() call controllable: it signals
    // `started` synchronously (so the test knows advance() has reached the
    // call) and then hangs on `pending` until the test resolves it.
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let resolveCreate!: (b: { id: string }) => void;
    const pending = new Promise<{ id: string }>((resolve) => {
      resolveCreate = resolve;
    });
    deps.benchmarks.create.mockImplementationOnce(async () => {
      started();
      return pending;
    });

    await prisma.automationRun.updateMany({ where: { id }, data: { lockedUntil: null } });
    const tickPromise = s.tick();
    await startedPromise; // advance() has called benchmarks.create(); its promise is still unresolved

    // Race: a revision trigger supersedes this run while the create() call
    // above is in flight. cancel() reads benchmarkId as still null at this
    // instant, so it cannot cancel the job it doesn't know exists yet.
    const rev2 = await prisma.deploymentRevision.create({
      data: { discoveredModelId: modelId, fingerprint: "race2", snapshot: {}, readyAt: new Date() },
    });
    await s.enqueue({
      discoveredModelId: modelId,
      revisionId: rev2.id,
      trigger: "revision",
      triggerKey: `revision:${rev2.id}`,
    });
    expect(deps.benchmarks.cancel).not.toHaveBeenCalled();

    const b = await prisma.benchmark.create({
      data: {
        userId,
        connectionId: connId,
        name: "race-b",
        scenario: "inference",
        tool: "guidellm",
        params: {},
        status: "completed",
        summaryMetrics: summary(1000),
        templateId,
      },
    });
    resolveCreate({ id: b.id });
    await tickPromise;

    const after = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("cancelled");
    expect(after.verdict).toBe("superseded");
    // The benchmark that was created after supersession is orphaned unless
    // advance() notices its own row is no longer "running" and cancels it.
    expect(deps.benchmarks.cancel).toHaveBeenCalledWith(b.id, userId);
    // No verdict was ever (re)written by the in-flight advance(), so no
    // automation.* notification fires for this run.
    expect(deps.notify.emit).not.toHaveBeenCalled();
  });

  it("benchmark ending failed yields error verdict and finishes the run", async () => {
    deps.benchmarks.create.mockImplementationOnce(async () =>
      prisma.benchmark.create({
        data: {
          userId,
          connectionId: connId,
          name: "failed-b",
          scenario: "inference",
          tool: "guidellm",
          params: {},
          status: "failed",
          templateId,
        },
      }),
    );
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:bfail",
    }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("error");
    expect(r.status).toBe("completed");
  });

  it("quality gate evaluation run FAILED yields error verdict", async () => {
    deps.runs.create.mockImplementationOnce(async () =>
      prisma.evaluationRun.create({
        data: {
          userId,
          evaluationId,
          evaluationVersion: 1,
          evaluationSnapshot: {},
          endpointAId: connId,
          gateConfig: {},
          status: "FAILED",
          totalSamples: 0,
        },
      }),
    );
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:qgfail",
    }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("error");
  });

  it("quality gate WARNING passes with the warning recorded", async () => {
    deps.runs.create.mockImplementationOnce(async () =>
      prisma.evaluationRun.create({
        data: {
          userId,
          evaluationId,
          evaluationVersion: 1,
          evaluationSnapshot: {},
          endpointAId: connId,
          gateConfig: {},
          status: "COMPLETED",
          gateResult: "WARNING",
          totalSamples: 0,
        },
      }),
    );
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:warn",
    }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("passed");
    expect((r.summary as { gateWarning?: boolean }).gateWarning).toBe(true);
  });

  // --- Important 3: lease expiry must not launch a second benchmark ---

  it("lease expiry cannot launch a second benchmark: the late one is cancelled, not recorded", async () => {
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:lease",
    }))!;
    for (let i = 0; i < 10; i++) {
      const cur = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
      if (cur.currentStep === "benchmark" && cur.status === "running") break;
      await prisma.automationRun.updateMany({ where: { id }, data: { lockedUntil: null } });
      await s.tick();
    }
    expect(
      (await prisma.automationRun.findUniqueOrThrow({ where: { id } })).benchmarkId,
    ).toBeNull();

    // Replica A's benchmarks.create() (a real K8s submit) hangs past the 60s lease.
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let resolveCreate!: (b: { id: string }) => void;
    const pending = new Promise<{ id: string }>((resolve) => {
      resolveCreate = resolve;
    });
    deps.benchmarks.create.mockImplementationOnce(async () => {
      started();
      return pending;
    });

    await prisma.automationRun.updateMany({ where: { id }, data: { lockedUntil: null } });
    const tickA = s.tick();
    await startedPromise;

    // Lease expires; replica B re-enters advance(), still sees benchmarkId
    // null, and submits its own benchmark — which it does record.
    await prisma.automationRun.updateMany({ where: { id }, data: { lockedUntil: null } });
    await s.tick();
    const mid = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
    expect(mid.benchmarkId).not.toBeNull();
    const keptId = mid.benchmarkId!;

    // A's submit finally returns. Without `benchmarkId: null` in the guard its
    // conditional write also reports count === 1 and B's job is orphaned.
    const late = await prisma.benchmark.create({
      data: {
        userId,
        connectionId: connId,
        name: "late-b",
        scenario: "inference",
        tool: "guidellm",
        params: {},
        status: "completed",
        summaryMetrics: summary(1000),
        templateId,
      },
    });
    resolveCreate({ id: late.id });
    await tickA;

    const after = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
    expect(after.benchmarkId).toBe(keptId);
    expect(deps.benchmarks.cancel).toHaveBeenCalledWith(late.id, userId);
  });

  // --- Important 5: another user's baseline must never be read ---

  it("compare() ignores a baseline owned by another user instead of leaking its metrics", async () => {
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
        summaryMetrics: summary(9999),
        templateId,
      },
    });
    const otherBaseline = await prisma.baseline.create({
      data: { userId: otherUserId, benchmarkId: otherBench.id, name: "secret", templateId },
    });
    await prisma.discoveredModel.update({
      where: { id: modelId },
      data: { baselineId: otherBaseline.id },
    });

    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "schedule",
      triggerKey: "schedule:xuser",
    }))!;
    const r = await tickUntilDone(s, id);

    const sum = r.summary as { regression?: { compared: boolean; reason?: string } };
    expect(sum.regression?.compared).toBe(false);
    expect(sum.regression?.reason).toBe("baseline missing");
    // The foreign benchmark's metrics never reach the summary / webhook payload.
    expect(JSON.stringify(r.summary)).not.toContain("9999");
  });

  // --- Important 6: a disabled source must stop launching work ---

  it("scanSchedules skips models whose platform source is disabled", async () => {
    const now = new Date("2026-09-22T00:00:00Z");
    await prisma.discoveredModel.update({
      where: { id: modelId },
      data: { schedule: "daily", nextScheduledAt: new Date("2026-09-21T23:59:00Z") },
    });
    await prisma.platformSource.update({ where: { id: sourceId }, data: { enabled: false } });

    expect(await svc().scanSchedules(now)).toBe(0);
    expect(await prisma.automationRun.count({ where: { discoveredModelId: modelId } })).toBe(0);

    // Re-enabling the source resumes the schedule.
    await prisma.platformSource.update({ where: { id: sourceId }, data: { enabled: true } });
    expect(await svc().scanSchedules(now)).toBe(1);
  });

  it("promotePending leaves pending runs pending while the source is disabled", async () => {
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:srcoff",
    }))!;
    await prisma.platformSource.update({ where: { id: sourceId }, data: { enabled: false } });

    await s.tick();

    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id } })).status).toBe(
      "pending",
    );
    expect(deps.diagnostics.run).not.toHaveBeenCalled();
  });

  // --- Minor 7: cancel() must not overwrite a run that just completed ---

  it("cancel() leaves a run that completes inside its read-then-write window alone", async () => {
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:cancelrace",
    }))!;
    await prisma.automationRun.update({
      where: { id },
      data: { status: "running", currentStep: "benchmark", benchmarkId: "bx" },
    });

    // Patch the delegate directly (vi.spyOn(...).mockRestore() leaves a Prisma
    // delegate method undefined for later tests) so the row completes in the
    // window between cancel()'s read and its write.
    const delegate = prisma.automationRun as unknown as Record<string, unknown>;
    const real = prisma.automationRun.findUnique.bind(prisma.automationRun);
    delegate.findUnique = async (args: unknown) => {
      const row = await real(args as never);
      // The run finishes (and fires its automation.passed notification) here.
      await prisma.automationRun.update({
        where: { id },
        data: { status: "completed", verdict: "passed", finishedAt: new Date() },
      });
      delegate.findUnique = real;
      return row;
    };

    try {
      await s.cancel(id, "superseded");
    } finally {
      delegate.findUnique = real;
    }

    const after = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("completed");
    expect(after.verdict).toBe("passed");
    // …and its already-finished child job was not cancelled behind its back.
    expect(deps.benchmarks.cancel).not.toHaveBeenCalled();
  });

  // --- Important 2: sync's removed-model cancellation goes through cancel() ---

  it("registers a cancel-runs listener that cancels the run and its child benchmark", async () => {
    const s = svc();
    s.onModuleInit();
    const listener = deps.sync.setCancelRunsListener.mock.calls[0]?.[0] as (
      discoveredModelId: string,
      reason: string,
    ) => Promise<void>;
    expect(listener).toBeTypeOf("function");

    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:removed",
    }))!;
    await prisma.automationRun.update({
      where: { id },
      data: { status: "running", currentStep: "benchmark", benchmarkId: "b-removed" },
    });

    await listener(modelId, "model removed from GPUStack");

    const after = await prisma.automationRun.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("cancelled");
    expect((after.summary as { reason?: string }).reason).toBe("model removed from GPUStack");
    // The whole point: the child GPU job is cancelled, which a raw
    // updateMany inside SourceSyncService could never do.
    expect(deps.benchmarks.cancel).toHaveBeenCalledWith("b-removed", userId);
  });

  it("a step throwing finishes the run with error and frees the source's running slot", async () => {
    deps.benchmarks.create.mockImplementationOnce(async () => {
      throw new Error("k8s exploded");
    });
    const s = svc();
    const id = (await s.enqueue({
      discoveredModelId: modelId,
      revisionId: revId,
      trigger: "manual",
      triggerKey: "manual:throw",
    }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("error");
    expect(await prisma.automationRun.count({ where: { sourceId, status: "running" } })).toBe(0);
  });
});
