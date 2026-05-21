import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import type { PrometheusDatasourceActor } from "./prometheus-datasource.service.js";
import { PrometheusDatasourceService } from "./prometheus-datasource.service.js";

// 32-byte base64 key for AES-256-GCM (same shape as env validator requires).
const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

const ADMIN: PrometheusDatasourceActor = { sub: "u_admin", isAdmin: true };
const USER: PrometheusDatasourceActor = { sub: "u_normal", isAdmin: false };

describe("PrometheusDatasourceService", () => {
  let prisma: PrismaService;
  let svc: PrometheusDatasourceService;

  beforeEach(async () => {
    // PrismaService's constructor requires ConfigService; in spec mode we read
    // DATABASE_URL straight from process.env (vitest.config sets it to the
    // _test DB). A stub ConfigService keeps the constructor signature happy.
    const fakeConfig = {
      get: (key: string) => process.env[key],
    } as unknown as ConstructorParameters<typeof PrismaService>[0];
    prisma = new PrismaService(fakeConfig);
    await prisma.$connect();
    // FK from connection.prometheus_datasource_id → prometheus_datasources.id is
    // ON DELETE SET NULL, so wiping the parent table first is fine, but to keep
    // the slate truly clean (and avoid stray connections from earlier suites
    // interfering with consumersCount assertions) delete connections first.
    await prisma.connection.deleteMany();
    await prisma.prometheusDatasource.deleteMany();
    await prisma.user.deleteMany({ where: { email: { in: ["u_normal@test", "u_admin@test"] } } });
    // Connections FK to users; some tests below create a connection for u_normal.
    await prisma.user.upsert({
      where: { email: "u_normal@test" },
      create: { id: "u_normal", email: "u_normal@test", passwordHash: "x", roles: ["user"] },
      update: {},
    });
    svc = new PrometheusDatasourceService(prisma, TEST_KEY_B64);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("list", () => {
    it("returns all rows (any auth user can read)", async () => {
      await prisma.prometheusDatasource.create({
        data: { name: "p1", baseUrl: "https://prom1.example.com" },
      });
      const r = await svc.list(USER);
      expect(r.items).toHaveLength(1);
      expect(r.items[0]?.consumersCount).toBe(0);
    });

    it("includes consumersCount aggregated from connections", async () => {
      const ds = await prisma.prometheusDatasource.create({
        data: { name: "p1", baseUrl: "https://prom1.example.com" },
      });
      await prisma.connection.create({
        data: {
          userId: "u_normal",
          name: "m1",
          baseUrl: "https://m1.example.com",
          apiKeyCipher: "x",
          model: "gpt",
          category: "chat",
          prometheusDatasourceId: ds.id,
        },
      });
      const r = await svc.list(USER);
      expect(r.items[0]?.consumersCount).toBe(1);
    });
  });

  describe("create", () => {
    it("admin can create", async () => {
      const r = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://prom1.example.com",
        customHeaders: "",
        isDefault: false,
      });
      expect(r.id).toBeTruthy();
      expect(r.bearerToken).toBe("");
    });

    it("non-admin is rejected", async () => {
      await expect(
        svc.create(USER, {
          name: "p1",
          baseUrl: "https://prom1.example.com",
          customHeaders: "",
          isDefault: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects duplicate name", async () => {
      await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://prom1.example.com",
        customHeaders: "",
        isDefault: false,
      });
      await expect(
        svc.create(ADMIN, {
          name: "p1",
          baseUrl: "https://prom2.example.com",
          customHeaders: "",
          isDefault: false,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects duplicate baseUrl", async () => {
      await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://prom1.example.com",
        customHeaders: "",
        isDefault: false,
      });
      await expect(
        svc.create(ADMIN, {
          name: "p2",
          baseUrl: "https://prom1.example.com",
          customHeaders: "",
          isDefault: false,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("encrypts bearerToken and returns plaintext once", async () => {
      const r = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://prom1.example.com",
        bearerToken: "secret-token-abc",
        customHeaders: "",
        isDefault: false,
      });
      expect(r.bearerToken).toBe("secret-token-abc");
      const row = await prisma.prometheusDatasource.findUnique({ where: { id: r.id } });
      expect(row?.bearerCipher).not.toContain("secret"); // encrypted
    });

    it("setting isDefault unsets any previous default", async () => {
      const first = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://prom1.example.com",
        customHeaders: "",
        isDefault: true,
      });
      await svc.create(ADMIN, {
        name: "p2",
        baseUrl: "https://prom2.example.com",
        customHeaders: "",
        isDefault: true,
      });
      const reloaded = await prisma.prometheusDatasource.findUnique({ where: { id: first.id } });
      expect(reloaded?.isDefault).toBe(false);
    });
  });

  describe("update", () => {
    it("partial update", async () => {
      const r = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://prom1.example.com",
        customHeaders: "",
        isDefault: false,
      });
      const updated = await svc.update(ADMIN, r.id, { name: "renamed" });
      expect(updated.name).toBe("renamed");
      expect(updated.baseUrl).toBe("https://prom1.example.com");
    });

    it("rotating bearerToken returns plaintext", async () => {
      const r = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://prom1.example.com",
        customHeaders: "",
        isDefault: false,
      });
      const updated = await svc.update(ADMIN, r.id, { bearerToken: "new-bearer" });
      expect("bearerToken" in updated).toBe(true);
      if ("bearerToken" in updated) expect(updated.bearerToken).toBe("new-bearer");
    });

    it("not found", async () => {
      await expect(svc.update(ADMIN, "nope", { name: "x" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("explicit isDefault=false demotes the row (un-default)", async () => {
      // Regression: the update() path previously only handled isDefault=true
      // (promote). Unchecking the "Set as default" checkbox in the edit
      // sheet sent isDefault=false, but the service silently ignored it,
      // so the row stayed default. UI looked broken.
      const r = await svc.create(ADMIN, {
        name: "p-demote",
        baseUrl: "https://p-demote.example.com",
        customHeaders: "",
        isDefault: true,
      });
      expect(r.isDefault).toBe(true);
      const updated = await svc.update(ADMIN, r.id, { isDefault: false });
      expect(updated.isDefault).toBe(false);
      const reloaded = await prisma.prometheusDatasource.findUnique({ where: { id: r.id } });
      expect(reloaded?.isDefault).toBe(false);
    });
  });

  describe("setDefault", () => {
    it("flips default in a transaction", async () => {
      const a = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://p1.com",
        customHeaders: "",
        isDefault: true,
      });
      const b = await svc.create(ADMIN, {
        name: "p2",
        baseUrl: "https://p2.com",
        customHeaders: "",
        isDefault: false,
      });
      const r = await svc.setDefault(ADMIN, b.id);
      expect(r.isDefault).toBe(true);
      const reA = await prisma.prometheusDatasource.findUnique({ where: { id: a.id } });
      expect(reA?.isDefault).toBe(false);
    });

    it("idempotent on already-default", async () => {
      const a = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://p1.com",
        customHeaders: "",
        isDefault: true,
      });
      const r = await svc.setDefault(ADMIN, a.id);
      expect(r.isDefault).toBe(true);
    });
  });

  describe("remove", () => {
    it("detaches consumers via SetNull and returns count", async () => {
      const ds = await svc.create(ADMIN, {
        name: "p1",
        baseUrl: "https://p1.com",
        customHeaders: "",
        isDefault: false,
      });
      await prisma.connection.create({
        data: {
          userId: "u_normal",
          name: "m1",
          baseUrl: "https://m1.com",
          apiKeyCipher: "x",
          model: "gpt",
          category: "chat",
          prometheusDatasourceId: ds.id,
        },
      });
      const r = await svc.remove(ADMIN, ds.id);
      expect(r.consumersDetached).toBe(1);
      const conn = await prisma.connection.findFirst({ where: { name: "m1" } });
      expect(conn?.prometheusDatasourceId).toBeNull();
    });
  });
});
