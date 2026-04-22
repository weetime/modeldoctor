import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";

describe("LoadTest (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects missing apiUrl", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .send({ apiKey: "k", model: "m", rate: 1, duration: 1 })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects rate=0", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 0, duration: 1 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/rate/i);
  });

  it("rejects duration>3600", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 1, duration: 99999 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/duration/i);
  });
});
