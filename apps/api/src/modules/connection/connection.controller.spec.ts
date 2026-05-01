import type { ConnectionPublic, ConnectionWithSecret, ListConnectionsResponse } from "@modeldoctor/contracts";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionController } from "./connection.controller.js";
import { ConnectionService } from "./connection.service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER: JwtPayload = { sub: "u_1", email: "alice@example.com", roles: [] };

const PUBLIC_FIXTURE: ConnectionPublic = {
  id: "c_1",
  userId: "u_1",
  name: "vllm-prod",
  baseUrl: "http://10.0.0.1:8000",
  apiKeyPreview: "sk-...1234",
  model: "qwen2.5",
  customHeaders: "",
  queryParams: "",
  category: "chat",
  tags: [],
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const SECRET_FIXTURE: ConnectionWithSecret = {
  ...PUBLIC_FIXTURE,
  apiKey: "sk-secret-12345",
};

const LIST_FIXTURE: ListConnectionsResponse = { items: [PUBLIC_FIXTURE] };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeMockService() {
  return {
    list: vi.fn(),
    create: vi.fn(),
    findOwnedPublic: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getOwnedDecrypted: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionController", () => {
  let controller: ConnectionController;
  let svc: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    svc = makeMockService();

    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [{ provide: ConnectionService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(ConnectionController);
  });

  // -------------------------------------------------------------------------
  // GET /connections
  // -------------------------------------------------------------------------
  describe("list", () => {
    it("calls service.list(userId) and returns the result", async () => {
      svc.list.mockResolvedValue(LIST_FIXTURE);
      const result = await controller.list(USER);
      expect(svc.list).toHaveBeenCalledWith("u_1");
      expect(result).toBe(LIST_FIXTURE);
    });
  });

  // -------------------------------------------------------------------------
  // POST /connections
  // -------------------------------------------------------------------------
  describe("create", () => {
    it("calls service.create(userId, body) and returns ConnectionWithSecret", async () => {
      svc.create.mockResolvedValue(SECRET_FIXTURE);
      const body = {
        name: "vllm-prod",
        baseUrl: "http://10.0.0.1:8000",
        apiKey: "sk-secret-12345",
        model: "qwen2.5",
        customHeaders: "",
        queryParams: "",
        category: "chat" as const,
        tags: [],
      };
      const result = await controller.create(USER, body);
      expect(svc.create).toHaveBeenCalledWith("u_1", body);
      expect(result).toBe(SECRET_FIXTURE);
    });
  });

  // -------------------------------------------------------------------------
  // GET /connections/:id
  // -------------------------------------------------------------------------
  describe("detail", () => {
    it("calls service.findOwnedPublic(userId, id) and returns ConnectionPublic", async () => {
      svc.findOwnedPublic.mockResolvedValue(PUBLIC_FIXTURE);
      const result = await controller.detail(USER, "c_1");
      expect(svc.findOwnedPublic).toHaveBeenCalledWith("u_1", "c_1");
      expect(result).toBe(PUBLIC_FIXTURE);
    });

    it("propagates NotFoundException from service", async () => {
      svc.findOwnedPublic.mockRejectedValue(new NotFoundException("Connection c_x not found"));
      await expect(controller.detail(USER, "c_x")).rejects.toThrow(NotFoundException);
    });

    it("propagates ForbiddenException from service", async () => {
      svc.findOwnedPublic.mockRejectedValue(new ForbiddenException());
      await expect(controller.detail(USER, "c_1")).rejects.toThrow(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /connections/:id
  // -------------------------------------------------------------------------
  describe("update", () => {
    it("returns ConnectionWithSecret when apiKey is rotated", async () => {
      svc.update.mockResolvedValue(SECRET_FIXTURE);
      const body = { apiKey: "sk-new-5678" };
      const result = await controller.update(USER, "c_1", body);
      expect(svc.update).toHaveBeenCalledWith("u_1", "c_1", body);
      expect(result).toBe(SECRET_FIXTURE);
    });

    it("returns ConnectionPublic when only metadata is updated", async () => {
      svc.update.mockResolvedValue(PUBLIC_FIXTURE);
      const body = { name: "renamed" };
      const result = await controller.update(USER, "c_1", body);
      expect(svc.update).toHaveBeenCalledWith("u_1", "c_1", body);
      expect(result).toBe(PUBLIC_FIXTURE);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /connections/:id
  // -------------------------------------------------------------------------
  describe("remove", () => {
    it("calls service.delete(userId, id) and returns void", async () => {
      svc.delete.mockResolvedValue(undefined);
      const result = await controller.remove(USER, "c_1");
      expect(svc.delete).toHaveBeenCalledWith("u_1", "c_1");
      expect(result).toBeUndefined();
    });

    it("propagates exceptions from service.delete", async () => {
      svc.delete.mockRejectedValue(new NotFoundException("not found"));
      await expect(controller.remove(USER, "c_missing")).rejects.toThrow(NotFoundException);
    });
  });
});
