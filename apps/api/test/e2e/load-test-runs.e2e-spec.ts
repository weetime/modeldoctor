import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { startPostgres, type TestDatabase } from "../helpers/postgres-container.js";

describe("LoadTestRuns (e2e)", () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startPostgres();
    // Must set BEFORE module compilation — ConfigModule caches env at boot
    process.env.DATABASE_URL = db.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.$disconnect();
      await app.close();
    }
    if (db) await db.teardown();
  });

  it("returns an empty list when no runs exist", async () => {
    const res = await request(app.getHttpServer()).get("/api/load-test/runs").expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("inserts a row directly and lists it", async () => {
    const prisma = app.get(PrismaService);
    await prisma.loadTestRun.create({
      data: {
        apiType: "chat",
        apiUrl: "http://x",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: {
          requests: 1,
          success: 1,
          throughput: 1,
          latencies: { mean: "1ms", p50: "1ms", p95: "1ms", p99: "1ms", max: "1ms" },
        },
        rawReport: "raw",
      },
    });
    const res = await request(app.getHttpServer()).get("/api/load-test/runs").expect(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].apiType).toBe("chat");
    expect(res.body.items[0].status).toBe("completed");
  });

  it("paginates with cursor", async () => {
    const prisma = app.get(PrismaService);
    // State carries over from the previous test within the same describe; seed 3 more rows
    for (let i = 0; i < 3; i++) {
      await prisma.loadTestRun.create({
        data: {
          apiType: "chat",
          apiUrl: `http://x/${i}`,
          model: "m",
          rate: 1,
          duration: 1,
          status: "completed",
          summaryJson: {},
          rawReport: "",
        },
      });
    }
    const first = await request(app.getHttpServer()).get("/api/load-test/runs?limit=2").expect(200);
    expect(first.body.items.length).toBe(2);
    expect(first.body.nextCursor).not.toBeNull();

    const second = await request(app.getHttpServer())
      .get(`/api/load-test/runs?limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);
    // Total 4 rows (1 from previous it + 3 seeded here), limit=2 → exactly 2 on each page
    expect(second.body.items.length).toBe(2);
    // Pages must not overlap
    const firstIds = first.body.items.map((r: { id: string }) => r.id);
    const secondIds = second.body.items.map((r: { id: string }) => r.id);
    for (const id of secondIds) {
      expect(firstIds).not.toContain(id);
    }
  });
});
