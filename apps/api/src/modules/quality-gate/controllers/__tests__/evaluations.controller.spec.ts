import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../../../auth/jwt.strategy.js";
import { EvaluationsService } from "../../services/evaluations.service.js";
import { EvaluationsController } from "../evaluations.controller.js";

const USER: JwtPayload = { sub: "user-001", email: "alice@example.com", roles: [] };

function makeMockSvc() {
  return {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    import: vi.fn(),
  };
}

describe("EvaluationsController", () => {
  let controller: EvaluationsController;
  let svc: ReturnType<typeof makeMockSvc>;

  beforeEach(async () => {
    svc = makeMockSvc();
    const moduleRef = await Test.createTestingModule({
      controllers: [EvaluationsController],
      providers: [{ provide: EvaluationsService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(EvaluationsController);
  });

  it("GET / — returns { items } wrapping the service result", async () => {
    const fakeItems = [{ id: "ev-1", name: "test-eval", version: 1, samples: [] }];
    svc.list.mockResolvedValue(fakeItems);

    const result = await controller.list(USER);

    expect(svc.list).toHaveBeenCalledWith(USER.sub);
    expect(result).toEqual({ items: fakeItems });
  });

  it("POST / — passes userId and body to service", async () => {
    const body = { name: "my-eval", samples: [] };
    const created = { id: "ev-2", name: "my-eval", version: 1, samples: [] };
    svc.create.mockResolvedValue(created);

    const result = await controller.create(USER, body as never);

    expect(svc.create).toHaveBeenCalledWith(USER.sub, body);
    expect(result).toEqual(created);
  });

  it("GET /:id — returns the evaluation when found", async () => {
    const evaluation = { id: "ev-3", name: "found-eval", version: 1, samples: [] };
    svc.get.mockResolvedValue(evaluation);

    const result = await controller.findOne(USER, "ev-3");

    expect(svc.get).toHaveBeenCalledWith(USER.sub, "ev-3");
    expect(result).toEqual(evaluation);
  });

  it("GET /:id — throws 404 when service returns null", async () => {
    svc.get.mockResolvedValue(null);

    await expect(controller.findOne(USER, "nonexistent")).rejects.toThrow(NotFoundException);
    await expect(controller.findOne(USER, "nonexistent")).rejects.toThrow(/nonexistent/);
  });

  it("PATCH /:id — passes userId, id, and body to service", async () => {
    const body = { name: "updated-name" };
    const updated = { id: "ev-4", name: "updated-name", version: 2, samples: [] };
    svc.update.mockResolvedValue(updated);

    const result = await controller.update(USER, "ev-4", body as never);

    expect(svc.update).toHaveBeenCalledWith(USER.sub, "ev-4", body);
    expect(result).toEqual(updated);
  });

  it("DELETE /:id — calls service.delete with userId and id", async () => {
    svc.delete.mockResolvedValue(undefined);

    await controller.remove(USER, "ev-5");

    expect(svc.delete).toHaveBeenCalledWith(USER.sub, "ev-5");
  });

  it("POST /import — parses import body and calls service.import", async () => {
    const importPayload = {
      format: "json",
      payload: [
        {
          id: "s1",
          idx: 0,
          prompt: "hello",
          expected: "world",
          judgeConfig: { kind: "exact-match" },
        },
      ],
    };
    const body = { name: "imported-eval", import: importPayload };
    const created = { id: "ev-6", name: "imported-eval", version: 1, samples: [] };
    svc.import.mockResolvedValue(created);

    const result = await controller.importSet(USER, body as never);

    expect(svc.import).toHaveBeenCalledWith(
      USER.sub,
      "imported-eval",
      expect.objectContaining({ format: "json" }),
    );
    expect(result).toEqual(created);
  });
});
