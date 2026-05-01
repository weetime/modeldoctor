import type { Baseline, ListBaselinesResponse } from "@modeldoctor/contracts";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BaselineController } from "./baseline.controller.js";
import { BaselineService } from "./baseline.service.js";

const USER: JwtPayload = { sub: "u_1", email: "alice@example.com", roles: [] };

const FIXTURE: Baseline = {
  id: "b_1",
  userId: "u_1",
  runId: "r_1",
  name: "throughput-anchor",
  description: null,
  tags: [],
  templateId: null,
  templateVersion: null,
  active: true,
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
};
const LIST: ListBaselinesResponse = { items: [FIXTURE] };

function makeMockService() {
  return { create: vi.fn(), list: vi.fn(), delete: vi.fn() };
}

describe("BaselineController", () => {
  let controller: BaselineController;
  let svc: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    svc = makeMockService();
    const moduleRef = await Test.createTestingModule({
      controllers: [BaselineController],
      providers: [{ provide: BaselineService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BaselineController);
  });

  describe("list", () => {
    it("calls service.list(userId)", async () => {
      svc.list.mockResolvedValue(LIST);
      const out = await controller.list(USER);
      expect(svc.list).toHaveBeenCalledWith("u_1");
      expect(out).toBe(LIST);
    });
  });

  describe("create", () => {
    it("calls service.create(userId, body)", async () => {
      svc.create.mockResolvedValue(FIXTURE);
      const body = { runId: "r_1", name: "throughput-anchor", tags: [] };
      const out = await controller.create(USER, body);
      expect(svc.create).toHaveBeenCalledWith("u_1", body);
      expect(out).toBe(FIXTURE);
    });

    it("propagates 404 / 403 / 409 from service", async () => {
      svc.create.mockRejectedValueOnce(new NotFoundException("r_x"));
      await expect(controller.create(USER, { runId: "r_x", name: "x", tags: [] })).rejects.toThrow(
        NotFoundException,
      );

      svc.create.mockRejectedValueOnce(new ForbiddenException());
      await expect(
        controller.create(USER, { runId: "r_other", name: "x", tags: [] }),
      ).rejects.toThrow(ForbiddenException);

      svc.create.mockRejectedValueOnce(new ConflictException("dup"));
      await expect(controller.create(USER, { runId: "r_1", name: "x", tags: [] })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("remove", () => {
    it("calls service.delete(userId, id) and returns void", async () => {
      svc.delete.mockResolvedValue(undefined);
      const out = await controller.remove(USER, "b_1");
      expect(svc.delete).toHaveBeenCalledWith("u_1", "b_1");
      expect(out).toBeUndefined();
    });
  });
});
