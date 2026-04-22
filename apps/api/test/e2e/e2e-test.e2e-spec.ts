import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";

describe("E2ETest (e2e)", () => {
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
      .post("/api/e2e-test")
      .send({ apiKey: "k", model: "m", probes: ["text"] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/apiUrl/);
  });

  it("rejects empty probes array", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/e2e-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", probes: [] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/probes/);
  });

  it("rejects unknown probe name", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/e2e-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", probes: ["bogus"] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/probes/);
  });
});
