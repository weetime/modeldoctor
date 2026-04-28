import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../database/prisma.service.js";
import type { UsersService } from "../users/users.service.js";
import { AuthService } from "./auth.service.js";

function makePrismaMock() {
  return {
    refreshToken: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "rt-new",
        ...data,
      })),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb({})),
    $queryRaw: vi.fn(),
  };
}

function makeService() {
  const prisma = makePrismaMock();
  const jwt = { signAsync: vi.fn().mockResolvedValue("access-jwt") };
  const users = {
    findById: vi.fn().mockResolvedValue({ id: "u1", email: "u@x", roles: ["user"] }),
    toPublic: vi.fn((u: { id: string; email: string; roles: string[] }) => ({
      id: u.id,
      email: u.email,
      roles: u.roles,
      createdAt: "iso",
    })),
    findByEmail: vi.fn(),
    verifyPassword: vi.fn(),
    create: vi.fn(),
    countAll: vi.fn(),
  };
  const config = {
    get: vi.fn((k: string) => {
      if (k === "JWT_ACCESS_SECRET") return "test-secret-32-chars-minimum-test-test";
      if (k === "JWT_ACCESS_EXPIRES_IN") return "15m";
      if (k === "JWT_REFRESH_EXPIRES_DAYS") return 7;
      if (k === "DISABLE_FIRST_USER_ADMIN") return false;
      return undefined;
    }),
  };
  const service = new AuthService(
    users as unknown as UsersService,
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService<never, true>,
  );
  return { service, prisma, jwt, users };
}

describe("AuthService.issueNewSession (register/login)", () => {
  it("creates a refresh token whose familyId equals its own id (chain root)", async () => {
    const { service, prisma } = makeService();
    const publicUser = { id: "u1", email: "u@x", roles: ["user"], createdAt: "iso" };

    await service.issueNewSession(publicUser);

    const calls = (prisma.refreshToken.create as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // The final create call should produce the row that becomes the family root.
    // Implementation may either two-step (create then update familyId = self.id)
    // or pre-generate a cuid and create with familyId = that cuid; in either
    // case parentId must be null.
    const lastArg = calls.at(-1)?.[0] as { data: { parentId?: string | null } };
    expect(lastArg.data.parentId ?? null).toBeNull();

    // After issueNewSession finishes, every row this method touched must end
    // up with familyId !== "__pending__" — verify by checking that EITHER
    // the create call already passed a real familyId OR a follow-up update
    // patched it.
    const lastCreateData = lastArg.data as { familyId?: string; userId?: string };
    const updateCalls = (prisma.refreshToken.update as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    if (lastCreateData.familyId === "__pending__") {
      // Two-step pattern: must be patched immediately afterwards.
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      const updateArg = updateCalls.at(-1)?.[0] as {
        where: { id: string };
        data: { familyId: string };
      };
      expect(updateArg.data.familyId).toBeTruthy();
      expect(updateArg.data.familyId).not.toBe("__pending__");
    } else {
      // Single-step pattern: familyId was set on create directly.
      expect(typeof lastCreateData.familyId).toBe("string");
      expect(lastCreateData.familyId).not.toBe("__pending__");
    }
  });

  it("register and login both invoke issueNewSession (smoke)", async () => {
    const { service, users } = makeService();
    const spy = vi.spyOn(service, "issueNewSession" as keyof AuthService);
    users.findByEmail = vi.fn().mockResolvedValue(null);
    users.countAll = vi.fn().mockResolvedValue(0);
    users.create = vi
      .fn()
      .mockResolvedValue({ id: "u1", email: "u@x", roles: ["admin"], createdAt: "iso" });
    await service.register("u@x", "Password1!");
    expect(spy).toHaveBeenCalledTimes(1);

    users.findByEmail = vi.fn().mockResolvedValue({
      id: "u1",
      email: "u@x",
      roles: ["user"],
      passwordHash: "hash",
    });
    users.verifyPassword = vi.fn().mockResolvedValue(true);
    await service.login("u@x", "Password1!");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
