import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";

const fakeUser = { sub: "u1", roles: [] };

class StubJwtGuard {
  canActivate(ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) {
    ctx.switchToHttp().getRequest().user = fakeUser;
    return true;
  }
}

describe("BenchmarkController", () => {
  let app: import("@nestjs/common").INestApplication;
  let svc: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    svc = {
      create: vi.fn(),
      list: vi.fn(),
      detail: vi.fn(),
      cancel: vi.fn(),
      delete: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [BenchmarkController],
      providers: [
        { provide: BenchmarkService, useValue: svc },
        { provide: PrismaService, useValue: {} },
        { provide: BENCHMARK_DRIVER, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: APP_GUARD, useClass: StubJwtGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /benchmarks: 201/200 with the row body", async () => {
    svc.create.mockResolvedValue({ id: "r1", state: "submitted" });
    const body = {
      name: "n",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "https://x.com",
      apiKey: "sk",
      model: "m",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    };
    const res = await request(app.getHttpServer()).post("/benchmarks").send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", state: "submitted" });
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining(body), fakeUser);
  });

  it("POST /benchmarks: 400 on Zod validation failure", async () => {
    const res = await request(app.getHttpServer()).post("/benchmarks").send({ name: "" });
    expect(res.status).toBe(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("GET /benchmarks: parses query through Zod and forwards to svc.list", async () => {
    svc.list.mockResolvedValue({ items: [], nextCursor: null });
    const res = await request(app.getHttpServer())
      .get("/benchmarks")
      .query({ limit: 10, state: "running" });
    expect(res.status).toBe(200);
    expect(svc.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, state: "running" }),
      fakeUser,
    );
  });

  it("GET /benchmarks/:id: forwards to svc.detail", async () => {
    svc.detail.mockResolvedValue({ id: "r1" });
    const res = await request(app.getHttpServer()).get("/benchmarks/r1");
    expect(res.status).toBe(200);
    expect(svc.detail).toHaveBeenCalledWith("r1", fakeUser);
  });

  it("POST /benchmarks/:id/cancel: forwards to svc.cancel", async () => {
    svc.cancel.mockResolvedValue({ id: "r1", state: "canceled" });
    const res = await request(app.getHttpServer()).post("/benchmarks/r1/cancel");
    expect(res.status).toBe(201);
    expect(svc.cancel).toHaveBeenCalledWith("r1", fakeUser);
  });

  it("DELETE /benchmarks/:id: 204", async () => {
    svc.delete.mockResolvedValue(undefined);
    const res = await request(app.getHttpServer()).delete("/benchmarks/r1");
    expect(res.status).toBe(204);
    expect(svc.delete).toHaveBeenCalledWith("r1", fakeUser);
  });
});
