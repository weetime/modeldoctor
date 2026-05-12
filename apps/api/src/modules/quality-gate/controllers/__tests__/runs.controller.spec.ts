import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../../../auth/jwt.strategy.js";
import { RunsRepository } from "../../repositories/runs.repository.js";
import { RunsService } from "../../services/runs.service.js";
import { RunsController } from "../runs.controller.js";

const USER: JwtPayload = { sub: "user-002", email: "bob@example.com", roles: [] };

function makeMockSvc() {
  return {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    cancel: vi.fn(),
    delete: vi.fn(),
  };
}

function makeMockRepo() {
  return {
    listSamples: vi.fn(),
  };
}

describe("RunsController", () => {
  let controller: RunsController;
  let svc: ReturnType<typeof makeMockSvc>;
  let repo: ReturnType<typeof makeMockRepo>;

  beforeEach(async () => {
    svc = makeMockSvc();
    repo = makeMockRepo();
    const moduleRef = await Test.createTestingModule({
      controllers: [RunsController],
      providers: [
        { provide: RunsService, useValue: svc },
        { provide: RunsRepository, useValue: repo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(RunsController);
  });

  it("POST / — passes userId and body to service", async () => {
    const body = {
      evaluationId: "ev-1",
      endpointAId: "conn-1",
      gateConfig: { passThreshold: 0.8 },
    };
    const created = {
      id: "run-1",
      userId: USER.sub,
      status: "PENDING",
      evaluationId: "ev-1",
      evaluationVersion: 1,
    };
    svc.create.mockResolvedValue(created);

    const result = await controller.create(USER, body as never);

    expect(svc.create).toHaveBeenCalledWith(USER.sub, body);
    expect(result).toEqual(created);
  });

  it("POST /:id/cancel — calls cancel and returns { ok: true }", async () => {
    svc.cancel.mockResolvedValue(undefined);

    const result = await controller.cancel(USER, "run-2");

    expect(svc.cancel).toHaveBeenCalledWith(USER.sub, "run-2");
    expect(result).toEqual({ ok: true });
  });

  it("GET /:id/samples — does ownership check then defers to repo.listSamples", async () => {
    const run = { id: "run-3", userId: USER.sub, status: "COMPLETED" };
    const samplesResponse = { items: [], total: 0, page: 1, pageSize: 20 };
    svc.get.mockResolvedValue(run);
    repo.listSamples.mockResolvedValue(samplesResponse);

    const q: import("@modeldoctor/contracts").ListRunSamplesQuery = {
      page: 1,
      pageSize: 20,
      filter: "all",
      sortBy: "idx",
    };
    const result = await controller.samples(USER, "run-3", q);

    // Ownership check must happen first
    expect(svc.get).toHaveBeenCalledWith(USER.sub, "run-3");
    // Then repo.listSamples with the run id
    expect(repo.listSamples).toHaveBeenCalledWith("run-3", q);
    expect(result).toEqual(samplesResponse);
  });

  it("GET /:id/samples — propagates 404 when ownership check fails", async () => {
    svc.get.mockRejectedValue(new NotFoundException("run not-mine not found"));

    const q: import("@modeldoctor/contracts").ListRunSamplesQuery = {
      page: 1,
      pageSize: 20,
      filter: "all",
      sortBy: "idx",
    };
    await expect(controller.samples(USER, "not-mine", q)).rejects.toThrow(NotFoundException);
    // repo.listSamples must NOT be called if ownership check threw
    expect(repo.listSamples).not.toHaveBeenCalled();
  });

  it("GET / — forwards userId and query to service.list", async () => {
    const listResult = { items: [], total: 0, page: 1, pageSize: 20 };
    svc.list.mockResolvedValue(listResult);

    const q = { page: 1, pageSize: 20 };
    const result = await controller.list(USER, q as never);

    expect(svc.list).toHaveBeenCalledWith(USER.sub, q);
    expect(result).toEqual(listResult);
  });

  it("GET /:id — delegates to service.get with userId and id", async () => {
    const run = { id: "run-4", userId: USER.sub, status: "RUNNING" };
    svc.get.mockResolvedValue(run);

    const result = await controller.get(USER, "run-4");

    expect(svc.get).toHaveBeenCalledWith(USER.sub, "run-4");
    expect(result).toEqual(run);
  });

  it("DELETE /:id — calls service.delete with userId and id", async () => {
    svc.delete.mockResolvedValue(undefined);

    await controller.remove(USER, "run-5");

    expect(svc.delete).toHaveBeenCalledWith(USER.sub, "run-5");
  });
});
