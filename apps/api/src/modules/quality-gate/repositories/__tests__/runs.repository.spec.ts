import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { type TestDatabase, startPostgres } from "../../../../../test/helpers/postgres-container.js";
import { RunsRepository } from "../runs.repository.js";

let db: TestDatabase;
let prisma: PrismaClient;
let repo: RunsRepository;
let userId: string;
let connA: string;
let connB: string;
let evalId: string;

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const user = await prisma.user.create({ data: { email: `runs-${Date.now()}@t`, passwordHash: "x", roles: [] } });
  userId = user.id;
  const a = await prisma.connection.create({ data: { userId, name: "A", baseUrl: "http://a", apiKeyCipher: "", model: "m", category: "chat" } });
  const b = await prisma.connection.create({ data: { userId, name: "B", baseUrl: "http://b", apiKeyCipher: "", model: "m", category: "chat" } });
  connA = a.id; connB = b.id;
  const e = await prisma.evaluation.create({ data: { userId, name: "e", samples: [{ id: "s0", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }], totalSamples: 1 } });
  evalId = e.id;
  repo = new RunsRepository(prisma);
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

describe("RunsRepository", () => {
  it("creates a run in PENDING and stores snapshot + total", async () => {
    const r = await repo.createPending({
      userId,
      evaluationId: evalId,
      evaluationVersion: 1,
      evaluationSnapshot: { samples: [{ id: "s0", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }] },
      endpointAId: connA,
      endpointBId: connB,
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.status).toBe("PENDING");
    expect(r.totalSamples).toBe(1);
  });

  it("transitions PENDING → RUNNING → COMPLETED with gate result", async () => {
    const r = await repo.createPending({
      userId, evaluationId: evalId, evaluationVersion: 1,
      evaluationSnapshot: { samples: [] },
      endpointAId: connA, gateConfig: { passRateMin: 0.9 },
    });
    await repo.markRunning(r.id);
    const updated = await repo.markCompleted(r.id, {
      passRateA: 0.95,
      bothPassCount: 0, bothFailCount: 0, totalErrors: 0, judgeCallCount: 0,
    }, { result: "PASSED", failures: [], warnings: [] });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.gateResult).toBe("PASSED");
  });

  it("saveSample writes row visible via paginated query with filter", async () => {
    const r = await repo.createPending({
      userId, evaluationId: evalId, evaluationVersion: 1,
      evaluationSnapshot: { samples: [] },
      endpointAId: connA, endpointBId: connB, gateConfig: { passRateMin: 0.9 },
    });
    await repo.saveSample({
      runId: r.id,
      sampleId: "s0",
      sampleIdx: 0,
      resultA: { call: { rawAnswer: "x", latencyMs: 10 }, judge: { passed: true } },
      resultB: { call: { rawAnswer: "y", latencyMs: 12 }, judge: { passed: false } },
      delta: "REGRESSION",
    });
    const page = await repo.listSamples(r.id, { filter: "regression", sortBy: "idx", page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0].delta).toBe("REGRESSION");
  });

  it("sweepRunningOnBoot transitions RUNNING → FAILED", async () => {
    const r = await repo.createPending({
      userId, evaluationId: evalId, evaluationVersion: 1,
      evaluationSnapshot: { samples: [] },
      endpointAId: connA, gateConfig: { passRateMin: 0.9 },
    });
    await repo.markRunning(r.id);
    const count = await repo.sweepRunningOnBoot();
    expect(count).toBeGreaterThanOrEqual(1);
    const after = await prisma.evaluationRun.findUnique({ where: { id: r.id } });
    expect(after?.status).toBe("FAILED");
    expect(after?.errorMessage).toMatch(/server restarted/);
  });
});
