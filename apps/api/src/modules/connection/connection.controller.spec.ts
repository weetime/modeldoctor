import type {
  ConnectionPublic,
  ConnectionWithSecret,
  ListConnectionsResponse,
} from "@modeldoctor/contracts";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionController } from "./connection.controller.js";
import { ConnectionService } from "./connection.service.js";
import { DiscoveryService } from "./discovery/discovery.service.js";

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
  prometheusDatasourceId: null,
  prometheusDatasource: null,
  serverKind: null,
  tokenizerHfId: null,
  evaluationProfileId: null,
  evaluationProfile: null,
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
    revealApiKey: vi.fn(),
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
      providers: [
        { provide: ConnectionService, useValue: svc },
        { provide: DiscoveryService, useValue: { discover: vi.fn() } },
      ],
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
        kind: "model" as const,
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
  // tokenizerHfId field
  // -------------------------------------------------------------------------
  describe("tokenizerHfId field", () => {
    it("create: response includes tokenizerHfId: null when not supplied", async () => {
      svc.create.mockResolvedValue(SECRET_FIXTURE);
      const body = {
        kind: "model" as const,
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
      expect(result.tokenizerHfId).toBeNull();
    });

    it("create: response includes tokenizerHfId when supplied", async () => {
      const fixtureWithTokenizer: ConnectionWithSecret = {
        ...SECRET_FIXTURE,
        tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct",
      };
      svc.create.mockResolvedValue(fixtureWithTokenizer);
      const body = {
        kind: "model" as const,
        name: "vllm-prod",
        baseUrl: "http://10.0.0.1:8000",
        apiKey: "sk-secret-12345",
        model: "qwen2.5",
        customHeaders: "",
        queryParams: "",
        category: "chat" as const,
        tags: [],
        tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct",
      };
      const result = await controller.create(USER, body);
      expect(result.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
    });

    it("update: response includes tokenizerHfId when updated", async () => {
      const fixtureWithTokenizer: ConnectionPublic = {
        ...PUBLIC_FIXTURE,
        tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct",
      };
      svc.update.mockResolvedValue(fixtureWithTokenizer);
      const body = { tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct" };
      const result = await controller.update(USER, "c_1", body);
      expect(svc.update).toHaveBeenCalledWith("u_1", "c_1", body);
      expect(result.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
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

describe("ConnectionController.revealKey", () => {
  let controller: ConnectionController;
  let svc: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    svc = makeMockService();
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        { provide: ConnectionService, useValue: svc },
        { provide: DiscoveryService, useValue: { discover: vi.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(ConnectionController);
  });

  it("returns plaintext apiKey for the owner", async () => {
    svc.revealApiKey.mockResolvedValue({ apiKey: "sk-secret-12345" });
    await expect(controller.revealKey(USER, "c_1")).resolves.toEqual({
      apiKey: "sk-secret-12345",
    });
    expect(svc.revealApiKey).toHaveBeenCalledWith(USER.sub, "c_1");
  });

  it("propagates ForbiddenException for non-owners", async () => {
    svc.revealApiKey.mockRejectedValue(new ForbiddenException());
    await expect(controller.revealKey(USER, "c_other")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("propagates NotFoundException for unknown ids", async () => {
    svc.revealApiKey.mockRejectedValue(new NotFoundException());
    await expect(controller.revealKey(USER, "c_404")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ConnectionController.discover", () => {
  let controller: ConnectionController;
  let discovery: { discover: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    discovery = { discover: vi.fn() };
    const module = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        { provide: ConnectionService, useValue: {} },
        { provide: DiscoveryService, useValue: discovery },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ConnectionController);
  });

  it("forwards request body to DiscoveryService and returns its response", async () => {
    const fake = {
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "ok" },
        models: { values: ["m"], confidence: "certain", evidence: "ok" },
        category: { value: "chat", confidence: "guess", evidence: "default" },
        suggestedTags: { values: ["vllm"], confidence: "guess", evidence: "ok" },
      },
    };
    discovery.discover.mockResolvedValue(fake);
    const r = await controller.discover({ baseUrl: "http://x" });
    expect(discovery.discover).toHaveBeenCalledWith({ baseUrl: "http://x" });
    expect(r).toEqual(fake);
  });
});
