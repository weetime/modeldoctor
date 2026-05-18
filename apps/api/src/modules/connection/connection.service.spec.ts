import type { ConnectionPublic } from "@modeldoctor/contracts";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type {
  Connection as PrismaConnection,
  PrometheusDatasource as PrismaPrometheusDatasource,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionService } from "./connection.service.js";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function makePrismaMock() {
  return {
    connection: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    prometheusDatasource: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

type RowWithProfile = PrismaConnection & {
  evaluationProfile: { id: string; slug: string; name: string; nameKey: string | null } | null;
  prometheusDatasource: PrismaPrometheusDatasource | null;
};

function makeRow(overrides: Partial<RowWithProfile> = {}): RowWithProfile {
  return {
    id: "c_1",
    userId: "u_1",
    kind: "model",
    name: "vllm-prod",
    baseUrl: "http://10.x.x.x:30888",
    apiKeyCipher: "v1:placeholder",
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
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

function makeDatasource(
  overrides: Partial<PrismaPrometheusDatasource> = {},
): PrismaPrometheusDatasource {
  return {
    id: "ds_1",
    name: "default",
    baseUrl: "https://prom.example.com",
    bearerCipher: "",
    customHeaders: "",
    isDefault: true,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

async function makeService(prismaMock: ReturnType<typeof makePrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ConnectionService,
      { provide: PrismaService, useValue: prismaMock },
      {
        provide: ConfigService,
        useValue: { get: () => KEY_B64 },
      },
    ],
  }).compile();
  return moduleRef.get(ConnectionService);
}

describe("ConnectionService", () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let service: ConnectionService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    // Default: no datasources exist. Individual tests that exercise the
    // three-state binding override these mocks.
    prismaMock.prometheusDatasource.findFirst.mockResolvedValue(null);
    prismaMock.prometheusDatasource.findUnique.mockResolvedValue(null);
    service = await makeService(prismaMock);
  });

  describe("create", () => {
    it("encrypts apiKey, stores cipher, returns ConnectionWithSecret containing plaintext once", async () => {
      const PLAINTEXT = "sk-secret-12345";
      let storedCipher = "";
      prismaMock.connection.create.mockImplementation(
        async (args: { data: { apiKeyCipher: string } & Record<string, unknown> }) => {
          storedCipher = args.data.apiKeyCipher;
          return makeRow({ apiKeyCipher: storedCipher });
        },
      );
      const out = await service.create("u_1", {
        kind: "model",
        name: "vllm-prod",
        baseUrl: "http://10.x.x.x:30888",
        apiKey: PLAINTEXT,
        model: "qwen2.5",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
      });
      expect(storedCipher).toMatch(/^v1:/);
      expect(storedCipher).not.toContain(PLAINTEXT);
      expect(out.apiKey).toBe(PLAINTEXT);
      expect(out.apiKeyPreview).toBe("sk-...2345");
    });

    it("persists serverKind when provided", async () => {
      let storedData: Record<string, unknown> = {};
      prismaMock.prometheusDatasource.findFirst.mockResolvedValue(null);
      prismaMock.connection.create.mockImplementation(
        async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
          storedData = args.data;
          return makeRow({
            apiKeyCipher: args.data.apiKeyCipher as string,
            serverKind: "vllm",
          });
        },
      );
      const out = await service.create("u_1", {
        kind: "model",
        name: "vllm-prod",
        baseUrl: "http://10.x.x.x:30888",
        apiKey: "sk-abc",
        model: "qwen2.5",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
        serverKind: "vllm",
      });
      expect(storedData.serverKind).toBe("vllm");
      expect(out.serverKind).toBe("vllm");
    });

    it("defaults serverKind to null when omitted", async () => {
      prismaMock.prometheusDatasource.findFirst.mockResolvedValue(null);
      prismaMock.connection.create.mockImplementation(
        async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
          return makeRow({ apiKeyCipher: args.data.apiKeyCipher as string });
        },
      );
      const out = await service.create("u_1", {
        kind: "model",
        name: "x",
        baseUrl: "http://x",
        apiKey: "k",
        model: "m",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
      });
      expect(out.serverKind).toBeNull();
    });
  });

  describe("create — prometheusDatasourceId three-state", () => {
    const ds = makeDatasource({ id: "ds_default", isDefault: true });

    beforeEach(() => {
      prismaMock.prometheusDatasource.findFirst.mockResolvedValue(ds);
      prismaMock.prometheusDatasource.findUnique.mockImplementation(
        async (args: { where: { id: string } }) =>
          args.where.id === ds.id ? { id: ds.id } : null,
      );
      prismaMock.connection.create.mockImplementation(
        async (args: {
          data: Record<string, unknown> & { apiKeyCipher: string; prometheusDatasourceId: unknown };
        }) =>
          makeRow({
            apiKeyCipher: args.data.apiKeyCipher,
            kind: args.data.kind as string,
            prometheusDatasourceId:
              (args.data.prometheusDatasourceId as string | null | undefined) ?? null,
            prometheusDatasource: args.data.prometheusDatasourceId === ds.id ? ds : null,
          }),
      );
    });

    it("undefined + kind=model fills with current default", async () => {
      const r = await service.create("u_a", {
        kind: "model",
        name: "m",
        baseUrl: "https://m.com",
        apiKey: "sk-abc",
        model: "gpt-4",
        category: "chat",
        customHeaders: "",
        queryParams: "",
        tags: [],
      });
      expect(r.prometheusDatasourceId).toBe(ds.id);
      expect(r.prometheusDatasource?.name).toBe(ds.name);
    });

    it("undefined + no default exists stores null", async () => {
      prismaMock.prometheusDatasource.findFirst.mockResolvedValue(null);
      const r = await service.create("u_a", {
        kind: "gateway",
        name: "g",
        baseUrl: "https://g.com",
        customHeaders: "",
        queryParams: "",
        tags: [],
      });
      expect(r.prometheusDatasourceId).toBeNull();
    });

    it("undefined + kind=alertmanager stores null even when default exists", async () => {
      const r = await service.create("u_a", {
        kind: "alertmanager",
        name: "am",
        baseUrl: "https://am.com",
        customHeaders: "",
        queryParams: "",
        tags: [],
      });
      expect(r.prometheusDatasourceId).toBeNull();
    });

    it("null explicit unbind stores null", async () => {
      const r = await service.create("u_a", {
        kind: "gateway",
        name: "g",
        baseUrl: "https://g.com",
        prometheusDatasourceId: null,
        customHeaders: "",
        queryParams: "",
        tags: [],
      });
      expect(r.prometheusDatasourceId).toBeNull();
    });

    it("explicit id is validated and stored", async () => {
      const r = await service.create("u_a", {
        kind: "gateway",
        name: "g",
        baseUrl: "https://g.com",
        prometheusDatasourceId: ds.id,
        customHeaders: "",
        queryParams: "",
        tags: [],
      });
      expect(r.prometheusDatasourceId).toBe(ds.id);
    });

    it("explicit non-existent id throws BadRequest with code PROMETHEUS_DATASOURCE_NOT_FOUND", async () => {
      const promise = service.create("u_a", {
        kind: "gateway",
        name: "g",
        baseUrl: "https://g.com",
        prometheusDatasourceId: "nope",
        customHeaders: "",
        queryParams: "",
        tags: [],
      });
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: { code: "PROMETHEUS_DATASOURCE_NOT_FOUND" },
      });
    });

    it("explicit id + kind=alertmanager rejected with code PROMETHEUS_DATASOURCE_INVALID_KIND", async () => {
      await expect(
        service.create("u_a", {
          kind: "alertmanager",
          name: "am",
          baseUrl: "https://am.com",
          prometheusDatasourceId: ds.id,
          customHeaders: "",
          queryParams: "",
          tags: [],
        }),
      ).rejects.toMatchObject({
        response: { code: "PROMETHEUS_DATASOURCE_INVALID_KIND" },
      });
    });

  });

  describe("toContractPublic — drops prometheusUrl + includes prometheusDatasource summary", () => {
    it("returns prometheusDatasource summary when bound", async () => {
      const ds = makeDatasource({ id: "ds_bound", isDefault: true });
      prismaMock.prometheusDatasource.findFirst.mockResolvedValue(ds);
      prismaMock.prometheusDatasource.findUnique.mockResolvedValue({ id: ds.id });
      prismaMock.connection.create.mockImplementation(
        async (args: { data: { apiKeyCipher: string; prometheusDatasourceId: string | null } }) =>
          makeRow({
            apiKeyCipher: args.data.apiKeyCipher,
            prometheusDatasourceId: args.data.prometheusDatasourceId,
            prometheusDatasource: ds,
          }),
      );
      const r = await service.create("u_a", {
        kind: "model",
        name: "m",
        baseUrl: "https://m.com",
        apiKey: "sk-abc",
        model: "gpt-4",
        category: "chat",
        prometheusDatasourceId: ds.id,
        customHeaders: "",
        queryParams: "",
        tags: [],
      });
      expect(r.prometheusDatasource).toEqual({
        id: ds.id,
        name: ds.name,
        baseUrl: ds.baseUrl,
      });
      expect("prometheusUrl" in r).toBe(false);
    });
  });

  describe("list", () => {
    it("returns items with apiKeyPreview only, never plaintext or cipher", async () => {
      const cipher = await encryptForTest("sk-secret-abcdefgh");
      prismaMock.connection.findMany.mockResolvedValue([makeRow({ apiKeyCipher: cipher })]);
      const out = await service.list("u_1");
      expect(out.items).toHaveLength(1);
      const item = out.items[0];
      expect(item).not.toHaveProperty("apiKey");
      expect(item).not.toHaveProperty("apiKeyCipher");
      expect(item.apiKeyPreview).toBe("sk-...efgh");
    });
  });

  describe("findOwnedPublic", () => {
    it("returns ConnectionPublic for the owner", async () => {
      const cipher = await encryptForTest("sk-aaa1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      const out = await service.findOwnedPublic("u_1", "c_1");
      expect(out.id).toBe("c_1");
      expect(out.apiKeyPreview).toBe("sk-...1234");
    });
    it("throws NotFoundException for missing", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(null);
      await expect(service.findOwnedPublic("u_1", "c_x")).rejects.toThrow(NotFoundException);
    });
    it("throws ForbiddenException when userId mismatches", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.findOwnedPublic("u_1", "c_1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("update", () => {
    it("returns ConnectionWithSecret when apiKey is rotated", async () => {
      const oldCipher = await encryptForTest("sk-old-1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: oldCipher }));
      let newCipher = "";
      prismaMock.connection.update.mockImplementation(
        async (args: { data: { apiKeyCipher?: string } }) => {
          newCipher = args.data.apiKeyCipher ?? "";
          return makeRow({ apiKeyCipher: newCipher });
        },
      );
      const out = await service.update("u_1", "c_1", { apiKey: "sk-new-5678" });
      expect("apiKey" in out).toBe(true);
      expect((out as { apiKey: string }).apiKey).toBe("sk-new-5678");
      expect(newCipher).toMatch(/^v1:/);
      expect(newCipher).not.toBe(oldCipher);
    });
    it("returns ConnectionPublic (no plaintext) when apiKey is not rotated", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      prismaMock.connection.update.mockResolvedValue(
        makeRow({ apiKeyCipher: cipher, name: "renamed" }),
      );
      const out = await service.update("u_1", "c_1", { name: "renamed" });
      expect("apiKey" in out).toBe(false);
      expect(out.name).toBe("renamed");
    });

    it("clears serverKind when caller passes null", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(
        makeRow({
          apiKeyCipher: cipher,
          serverKind: "vllm",
        }),
      );
      let updateData: Record<string, unknown> = {};
      prismaMock.connection.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return makeRow({
            apiKeyCipher: cipher,
            serverKind: null,
          });
        },
      );
      const out = await service.update("u_1", "c_1", {
        serverKind: null,
      });
      expect(updateData.serverKind).toBeNull();
      expect(out.serverKind).toBeNull();
    });

    it("update accepts evaluationProfileId and surfaces evaluationProfile join", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      prismaMock.connection.update.mockResolvedValue(
        makeRow({
          apiKeyCipher: cipher,
          evaluationProfileId: "clxprofdefault0000000000",
          evaluationProfile: {
            id: "clxprofdefault0000000000",
            slug: "default",
            name: "通用",
            nameKey: "profiles.default.name",
          },
        }),
      );
      const out = await service.update("u_1", "c_1", {
        evaluationProfileId: "clxprofdefault0000000000",
      });
      expect((out as ConnectionPublic).evaluationProfileId).toBe("clxprofdefault0000000000");
      expect((out as ConnectionPublic).evaluationProfile?.slug).toBe("default");
    });
  });

  describe("getOwnedDecrypted", () => {
    it("decrypts apiKey and returns the full credential bundle", async () => {
      const cipher = await encryptForTest("sk-decrypt-test");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      const out = await service.getOwnedDecrypted("u_1", "c_1");
      expect(out.apiKey).toBe("sk-decrypt-test");
      expect(out.baseUrl).toBe("http://10.x.x.x:30888");
      expect(out.model).toBe("qwen2.5");
    });
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.getOwnedDecrypted("u_1", "c_1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("revealApiKey", () => {
    it("returns decrypted apiKey for the owner", async () => {
      const PLAINTEXT = "sk-reveal-test-1234";
      const cipher = await encryptForTest(PLAINTEXT);
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      const out = await service.revealApiKey("u_1", "c_1");
      expect(out).toEqual({ apiKey: PLAINTEXT });
    });

    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.revealApiKey("u_1", "c_1")).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException for unknown id", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(null);
      await expect(service.revealApiKey("u_1", "c_x")).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.delete("u_1", "c_1")).rejects.toThrow(ForbiddenException);
      expect(prismaMock.connection.delete).not.toHaveBeenCalled();
    });

    it("calls prisma.delete after ownership check passes", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow());
      prismaMock.connection.delete.mockResolvedValue(makeRow());
      await service.delete("u_1", "c_1");
      expect(prismaMock.connection.delete).toHaveBeenCalledWith({ where: { id: "c_1" } });
    });
  });

  describe("update RBAC", () => {
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.update("u_1", "c_1", { name: "x" })).rejects.toThrow(ForbiddenException);
      expect(prismaMock.connection.update).not.toHaveBeenCalled();
    });
  });

  describe("tokenizerHfId", () => {
    it("persists tokenizerHfId when provided on create", async () => {
      let storedData: Record<string, unknown> = {};
      prismaMock.connection.create.mockImplementation(
        async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
          storedData = args.data;
          return makeRow({
            apiKeyCipher: args.data.apiKeyCipher as string,
            tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct",
          });
        },
      );
      const out = await service.create("u_1", {
        kind: "model",
        name: "vllm-prod",
        baseUrl: "http://10.x.x.x:30888",
        apiKey: "sk-abc",
        model: "qwen2.5",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
        tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct",
      });
      expect(storedData.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
      expect(out.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
    });

    it("defaults tokenizerHfId to null when omitted on create", async () => {
      let storedData: Record<string, unknown> = {};
      prismaMock.connection.create.mockImplementation(
        async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
          storedData = args.data;
          return makeRow({ apiKeyCipher: args.data.apiKeyCipher as string });
        },
      );
      const out = await service.create("u_1", {
        kind: "model",
        name: "x",
        baseUrl: "http://x",
        apiKey: "k",
        model: "m",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
      });
      expect(storedData.tokenizerHfId).toBeNull();
      expect(out.tokenizerHfId).toBeNull();
    });

    it("updates tokenizerHfId via service.update", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      let updateData: Record<string, unknown> = {};
      prismaMock.connection.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return makeRow({
            apiKeyCipher: cipher,
            tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct",
          });
        },
      );
      const out = await service.update("u_1", "c_1", {
        tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct",
      });
      expect(updateData.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
      expect(out.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
    });

    it("clears tokenizerHfId when caller passes null", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(
        makeRow({ apiKeyCipher: cipher, tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct" }),
      );
      let updateData: Record<string, unknown> = {};
      prismaMock.connection.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return makeRow({ apiKeyCipher: cipher, tokenizerHfId: null });
        },
      );
      const out = await service.update("u_1", "c_1", { tokenizerHfId: null });
      expect(updateData.tokenizerHfId).toBeNull();
      expect(out.tokenizerHfId).toBeNull();
    });

    it("returns tokenizerHfId in DecryptedConnection from getOwnedDecrypted", async () => {
      const cipher = await encryptForTest("sk-decrypt-test");
      prismaMock.connection.findUnique.mockResolvedValue(
        makeRow({ apiKeyCipher: cipher, tokenizerHfId: "Qwen/Qwen2.5-0.5B-Instruct" }),
      );
      const out = await service.getOwnedDecrypted("u_1", "c_1");
      expect(out.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
    });

    it("returns tokenizerHfId: null in DecryptedConnection when not set", async () => {
      const cipher = await encryptForTest("sk-decrypt-test");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      const out = await service.getOwnedDecrypted("u_1", "c_1");
      expect(out.tokenizerHfId).toBeNull();
    });
  });
});

async function encryptForTest(plaintext: string): Promise<string> {
  const { encrypt, decodeKey } = await import("../../common/crypto/aes-gcm.js");
  return encrypt(plaintext, decodeKey(KEY_B64));
}
