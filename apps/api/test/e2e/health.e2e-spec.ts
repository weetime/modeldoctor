import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { HealthResponseSchema, CheckVegetaResponseSchema } from "@modeldoctor/contracts";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health → 200 with legacy-compatible shape", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);
    const parsed = HealthResponseSchema.parse(res.body);
    expect(parsed.status).toBe("ok");
    expect(new Date(parsed.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("GET /api/check-vegeta → 200 with legacy-compatible shape", async () => {
    const res = await request(app.getHttpServer()).get("/api/check-vegeta").expect(200);
    const parsed = CheckVegetaResponseSchema.parse(res.body);
    expect(typeof parsed.installed).toBe("boolean");
    if (parsed.installed) {
      expect(parsed.path).toMatch(/\S/);
    } else {
      expect(parsed.path).toBeNull();
    }
  });
});
