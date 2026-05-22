import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startPostgres,
  type TestDatabase,
} from "../../../../../test/helpers/postgres-container.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import { EvaluationsRepository } from "../evaluations.repository.js";

let db: TestDatabase;
let prisma: PrismaClient;
let repo: EvaluationsRepository;
let userId: string;

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const user = await prisma.user.create({
    data: { email: `qg-${Date.now()}@test`, passwordHash: "x", roles: [] },
  });
  userId = user.id;
  // The repo accepts PrismaService (Nest provider), but for integration
  // tests we instantiate a bare PrismaClient against testcontainers.
  // PrismaService extends PrismaClient so the runtime behaviour is identical;
  // cast through unknown to satisfy the structural-typing check.
  repo = new EvaluationsRepository(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

const sample = (idx: number) => ({
  id: `s${idx}`,
  idx,
  prompt: "Q?",
  expected: "A",
  judgeConfig: { kind: "exact-match" as const },
});

describe("EvaluationsRepository", () => {
  it("creates an evaluation and reads it back", async () => {
    const created = await repo.create(userId, {
      name: "set1",
      description: null,
      samples: [sample(0), sample(1)],
    });
    expect(created.totalSamples).toBe(2);
    const fetched = await repo.findById(userId, created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it("lists by user (newest first)", async () => {
    const items = await repo.list(userId);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].createdAt >= items[items.length - 1].createdAt).toBe(true);
  });

  it("updates samples and bumps version + totalSamples", async () => {
    const e = await repo.create(userId, { name: "v2", samples: [sample(0)] });
    const updated = await repo.update(userId, e.id, { samples: [sample(0), sample(1), sample(2)] });
    expect(updated.totalSamples).toBe(3);
    expect(updated.version).toBe(e.version + 1);
  });

  it("delete is blocked when a run references it", async () => {
    const e = await repo.create(userId, { name: "ref", samples: [sample(0)] });
    // Need a real Connection row to satisfy the endpointAId FK (onDelete: Restrict).
    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "test-conn",
        baseUrl: "https://example.test",
        apiKeyCipher: "unused",
        model: "test-model",
        category: "chat",
      },
    });
    await prisma.evaluationRun.create({
      data: {
        userId,
        evaluationId: e.id,
        evaluationVersion: e.version,
        evaluationSnapshot: { samples: [sample(0)] },
        endpointAId: conn.id,
        gateConfig: { passRateMin: 0.9 },
        totalSamples: 1,
      },
    });
    await expect(repo.delete(userId, e.id)).rejects.toBeTruthy();
  });
});
