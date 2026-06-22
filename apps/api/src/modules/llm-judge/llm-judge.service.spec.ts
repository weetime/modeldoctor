// apps/api/src/modules/llm-judge/llm-judge.service.spec.ts

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import type { LlmJudgeActor } from "./llm-judge.service.js";
import { LlmJudgeService } from "./llm-judge.service.js";

// 32-byte base64 key for AES-256-GCM (same shape as env validator requires).
const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

const ADMIN: LlmJudgeActor = { sub: "u_admin", isAdmin: true };
const USER: LlmJudgeActor = { sub: "u_normal", isAdmin: false };

const base = (
  name: string,
  over: Partial<{ enabled: boolean; isDefault: boolean; apiStyle: "openai" | "anthropic" }> = {},
) => ({
  name,
  baseUrl: "https://api.example.com",
  apiKey: "sk-secret-key",
  model: "gpt-x",
  apiStyle: "openai" as const,
  enabled: true,
  isDefault: false,
  ...over,
});

describe("LlmJudgeService", () => {
  let prisma: PrismaService;
  let svc: LlmJudgeService;

  beforeEach(async () => {
    const fakeConfig = {
      get: (key: string) =>
        key === "CONNECTION_API_KEY_ENCRYPTION_KEY" ? TEST_KEY_B64 : process.env[key],
    } as unknown as ConfigService<never, true>;
    prisma = new PrismaService({
      get: (k: string) => process.env[k],
    } as unknown as ConstructorParameters<typeof PrismaService>[0]);
    await prisma.$connect();
    await prisma.llmJudgeProvider.deleteMany();
    svc = new LlmJudgeService(prisma, fakeConfig);
  });

  afterAll(async () => {
    // Other service specs (synthesize/judges/explainer/compare) share this DB
    // and assume "no provider configured", so leave no rows behind.
    await prisma.llmJudgeProvider.deleteMany();
    await prisma.$disconnect();
  });

  describe("list / getOne", () => {
    it("lists rows default-first (any auth user can read)", async () => {
      await svc.create(ADMIN, base("p1"));
      await svc.create(ADMIN, base("p2", { isDefault: true }));
      const r = await svc.list(USER);
      expect(r.items).toHaveLength(2);
      expect(r.items[0]?.name).toBe("p2"); // default first
      // apiKey never leaks; preview is masked.
      expect((r.items[0] as Record<string, unknown>).apiKey).toBeUndefined();
      expect(r.items[0]?.apiKeyPreview).toMatch(/\.\.\./);
    });

    it("getOne not found", async () => {
      await expect(svc.getOne(USER, "nope")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("create", () => {
    it("non-admin is rejected", async () => {
      await expect(svc.create(USER, base("p1"))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects duplicate name", async () => {
      await svc.create(ADMIN, base("dup"));
      await expect(svc.create(ADMIN, base("dup"))).rejects.toBeInstanceOf(ConflictException);
    });

    it("encrypts apiKey (cipher does not contain plaintext)", async () => {
      const r = await svc.create(ADMIN, base("p1"));
      const row = await prisma.llmJudgeProvider.findUnique({ where: { id: r.id } });
      expect(row?.apiKeyCipher).not.toContain("sk-secret");
    });

    it("setting isDefault unsets any previous default", async () => {
      const first = await svc.create(ADMIN, base("p1", { isDefault: true }));
      await svc.create(ADMIN, base("p2", { isDefault: true }));
      const reloaded = await prisma.llmJudgeProvider.findUnique({ where: { id: first.id } });
      expect(reloaded?.isDefault).toBe(false);
    });

    it("creating as default is enabled and default", async () => {
      const r = await svc.create(ADMIN, base("p1", { isDefault: true }));
      expect(r.isDefault).toBe(true);
      expect(r.enabled).toBe(true);
    });

    it("rejects isDefault=true with enabled=false", async () => {
      await expect(
        svc.create(ADMIN, base("p1", { isDefault: true, enabled: false })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("update", () => {
    it("partial update keeps untouched fields", async () => {
      const r = await svc.create(ADMIN, base("p1"));
      const updated = await svc.update(ADMIN, r.id, { name: "renamed" });
      expect(updated.name).toBe("renamed");
      expect(updated.baseUrl).toBe("https://api.example.com");
    });

    it("rotating apiKey re-encrypts and decrypts back", async () => {
      const r = await svc.create(ADMIN, base("p1"));
      await svc.update(ADMIN, r.id, { apiKey: "sk-rotated-key" });
      const dec = await svc.getDecrypted({ id: r.id });
      expect(dec?.apiKey).toBe("sk-rotated-key");
    });

    it("omitting apiKey keeps the saved key", async () => {
      const r = await svc.create(ADMIN, base("p1"));
      await svc.update(ADMIN, r.id, { model: "gpt-y" });
      const dec = await svc.getDecrypted({ id: r.id });
      expect(dec?.apiKey).toBe("sk-secret-key");
    });

    it("not found", async () => {
      await expect(svc.update(ADMIN, "nope", { name: "x" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("rejects disabling the default provider", async () => {
      const r = await svc.create(ADMIN, base("p1", { isDefault: true }));
      await expect(svc.update(ADMIN, r.id, { enabled: false })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("explicit isDefault=false demotes (zero-default state allowed)", async () => {
      const r = await svc.create(ADMIN, base("p1", { isDefault: true }));
      const updated = await svc.update(ADMIN, r.id, { isDefault: false });
      expect(updated.isDefault).toBe(false);
    });

    it("demoting then disabling is allowed in one call", async () => {
      const r = await svc.create(ADMIN, base("p1", { isDefault: true }));
      const updated = await svc.update(ADMIN, r.id, { isDefault: false, enabled: false });
      expect(updated.isDefault).toBe(false);
      expect(updated.enabled).toBe(false);
    });
  });

  describe("setDefault", () => {
    it("flips default and enables the promoted (even if it was disabled)", async () => {
      const a = await svc.create(ADMIN, base("p1", { isDefault: true }));
      const b = await svc.create(ADMIN, base("p2", { enabled: false }));
      const r = await svc.setDefault(ADMIN, b.id);
      expect(r.isDefault).toBe(true);
      expect(r.enabled).toBe(true); // promotion enables
      const reA = await prisma.llmJudgeProvider.findUnique({ where: { id: a.id } });
      expect(reA?.isDefault).toBe(false);
    });

    it("non-admin rejected", async () => {
      const a = await svc.create(ADMIN, base("p1"));
      await expect(svc.setDefault(USER, a.id)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("remove", () => {
    it("deletes the row", async () => {
      const r = await svc.create(ADMIN, base("p1"));
      await svc.remove(ADMIN, r.id);
      expect(await prisma.llmJudgeProvider.findUnique({ where: { id: r.id } })).toBeNull();
    });

    it("not found", async () => {
      await expect(svc.remove(ADMIN, "nope")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getDecrypted", () => {
    it("returns null when no default exists", async () => {
      await svc.create(ADMIN, base("p1")); // not default
      expect(await svc.getDecrypted()).toBeNull();
    });

    it("returns the default provider with no selector", async () => {
      await svc.create(ADMIN, base("p1"));
      const def = await svc.create(ADMIN, base("p2", { isDefault: true }));
      const dec = await svc.getDecrypted();
      expect(dec?.id).toBe(def.id);
      expect(dec?.apiKey).toBe("sk-secret-key");
      expect(dec?.enabled).toBe(true);
    });

    it("returns a specific provider by id", async () => {
      const a = await svc.create(ADMIN, base("p1", { isDefault: true }));
      const b = await svc.create(ADMIN, base("p2"));
      const dec = await svc.getDecrypted({ id: b.id });
      expect(dec?.id).toBe(b.id);
      expect(dec?.id).not.toBe(a.id);
    });
  });
});
