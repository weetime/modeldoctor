import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type TestDatabase, startPostgres } from "../helpers/postgres-container.js";

describe("LoadTest (e2e)", () => {
  let app: INestApplication;
  let db: TestDatabase;
  let accessToken: string;

  beforeAll(async () => {
    db = await startPostgres();
    process.env.DATABASE_URL = db.url;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    // Register a user to get a bearer token for authenticated requests
    const registerRes = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "loadtest@example.com", password: "Password1!" });
    accessToken = registerRes.body.accessToken as string;
  }, 120_000);

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.$disconnect();
      await app.close();
    }
    if (db) await db.teardown();
  });

  it("rejects missing apiUrl", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiKey: "k", model: "m", rate: 1, duration: 1 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects rate=0", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 0, duration: 1 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/rate/i);
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects duration>3600", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 1, duration: 99999 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/duration/i);
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
