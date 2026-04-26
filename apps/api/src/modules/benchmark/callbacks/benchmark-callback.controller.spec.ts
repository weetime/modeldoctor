import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkService } from "../benchmark.service.js";
import { BenchmarkCallbackController } from "./benchmark-callback.controller.js";
import { HmacCallbackGuard } from "./hmac-callback.guard.js";
import { signCallbackToken } from "./hmac-token.js";

// Plan deviation (same as Task 4): the plan's `SECRET = randomBytes(32)` then
// `SECRET.toString("utf8")` round-trip is lossy for non-UTF-8 byte sequences,
// which makes the guard's reconstructed Buffer differ from the signing key
// and the test flakes. Use a safe ASCII string and convert to Buffer once.
const SECRET_STR = "x".repeat(48);
const SECRET = Buffer.from(SECRET_STR, "utf8");

describe("BenchmarkCallbackController", () => {
  let app: import("@nestjs/common").INestApplication;
  let svc: {
    handleStateCallback: ReturnType<typeof vi.fn>;
    handleMetricsCallback: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    svc = {
      handleStateCallback: vi.fn(async () => undefined),
      handleMetricsCallback: vi.fn(async () => undefined),
    };
    const module = await Test.createTestingModule({
      controllers: [BenchmarkCallbackController],
      providers: [
        { provide: BenchmarkService, useValue: svc },
        HmacCallbackGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => (k === "BENCHMARK_CALLBACK_SECRET" ? SECRET_STR : undefined),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("POST state with valid HMAC: 200 + svc called", async () => {
    const id = "r1";
    const tok = signCallbackToken(id, SECRET, 600);
    const res = await request(app.getHttpServer())
      .post(`/internal/benchmarks/${id}/state`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ state: "running", progress: 0.1 });
    expect(res.status).toBe(200);
    expect(svc.handleStateCallback).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ state: "running", progress: 0.1 }),
    );
  });

  it("POST state without Authorization: 401 + svc NOT called", async () => {
    const res = await request(app.getHttpServer())
      .post("/internal/benchmarks/r1/state")
      .send({ state: "running" });
    expect(res.status).toBe(401);
    expect(svc.handleStateCallback).not.toHaveBeenCalled();
  });

  it("POST state with token signed for a different id: 401", async () => {
    const tok = signCallbackToken("other", SECRET, 600);
    const res = await request(app.getHttpServer())
      .post("/internal/benchmarks/r1/state")
      .set("Authorization", `Bearer ${tok}`)
      .send({ state: "running" });
    expect(res.status).toBe(401);
  });

  it("POST state with bad payload: 400", async () => {
    const tok = signCallbackToken("r1", SECRET, 600);
    const res = await request(app.getHttpServer())
      .post("/internal/benchmarks/r1/state")
      .set("Authorization", `Bearer ${tok}`)
      .send({ state: "bogus" });
    expect(res.status).toBe(400);
  });

  it("POST metrics with valid HMAC: 200 + svc called", async () => {
    const tok = signCallbackToken("r1", SECRET, 600);
    const summary = {
      ttft: { mean: 1, p50: 1, p95: 2, p99: 3 },
      itl: { mean: 1, p50: 1, p95: 2, p99: 3 },
      e2eLatency: { mean: 1, p50: 1, p95: 2, p99: 3 },
      requestsPerSecond: { mean: 10 },
      outputTokensPerSecond: { mean: 100 },
      inputTokensPerSecond: { mean: 50 },
      totalTokensPerSecond: { mean: 150 },
      concurrency: { mean: 1, max: 1 },
      requests: { total: 100, success: 99, error: 1, incomplete: 0 },
    };
    const res = await request(app.getHttpServer())
      .post("/internal/benchmarks/r1/metrics")
      .set("Authorization", `Bearer ${tok}`)
      .send({ metricsSummary: summary, rawMetrics: { foo: 1 }, logs: "tail" });
    expect(res.status).toBe(200);
    expect(svc.handleMetricsCallback).toHaveBeenCalled();
  });
});
