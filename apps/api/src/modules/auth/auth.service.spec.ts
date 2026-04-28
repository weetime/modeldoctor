import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../database/prisma.service.js";
import type { UsersService } from "../users/users.service.js";
import { AuthService } from "./auth.service.js";

function makePrismaMock() {
  const mock: {
    refreshToken: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
  } = {
    refreshToken: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "rt-new",
        ...data,
      })),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    // Pass the prisma instance itself as the tx client so $transaction-wrapped
    // calls (e.g. issueNewSession's chain-root insert) hit the same spies as
    // direct calls. This matches Prisma's runtime behavior where tx.refreshToken
    // exposes the same delegate as prisma.refreshToken.
    $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(mock)),
    $queryRaw: vi.fn(),
  };
  return mock;
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

  it("runs chain-root insert inside a $transaction (atomicity contract)", async () => {
    const { service, prisma } = makeService();
    const publicUser = { id: "u1", email: "u@x", roles: ["user"], createdAt: "iso" };

    await service.issueNewSession(publicUser);

    // The whole chain-root insert (create + familyId-patch update) must
    // be wrapped in $transaction so a crash between the two writes can
    // never leave an orphan row with familyId === "__pending__".
    const txCalls = (prisma.$transaction as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(txCalls.length, "issueNewSession must call $transaction").toBeGreaterThanOrEqual(1);
  });
});

describe("AuthService.refresh (happy path)", () => {
  it("rotates: revokes parent + replacedById, child has parentId+familyId, used FOR UPDATE", async () => {
    const presented = "raw-refresh-token-xxx";
    const parentRow = {
      id: "rt-parent",
      user_id: "u1",
      family_id: "fam-1",
      parent_id: null,
      replaced_by_id: null,
      expires_at: new Date(Date.now() + 86_400_000),
      revoked_at: null,
    };
    const { service, prisma } = makeService();

    // FOR UPDATE returns the parent row.
    (prisma.$queryRaw as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      parentRow,
    ]);

    // After issueRotation creates the child, the service does
    // tx.refreshToken.findUnique({ where: { tokenHash } }) to find the row id.
    // Provide a deterministic id so the assertion on replacedById is stable.
    (
      prisma.refreshToken.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({ id: "rt-child" });

    // create() returns whatever data was passed in, with id = "rt-new".
    // (this mock was set in makePrismaMock and we keep its default behavior.)

    const result = await service.refresh(presented);

    expect(result.kind).toBe("rotated");
    if (result.kind !== "rotated") throw new Error("type narrow");
    expect(result.refreshToken).toBeTruthy();
    expect(result.accessToken).toBe("access-jwt");
    expect(result.user.id).toBe("u1");

    // Parent was marked revoked + replacedBy = the child id.
    const updateCalls = (prisma.refreshToken.update as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const lastUpdate = updateCalls.at(-1)?.[0] as {
      where: { id: string };
      data: { revokedAt: Date; replacedById: string };
    };
    expect(lastUpdate.where.id).toBe("rt-parent");
    expect(lastUpdate.data.revokedAt).toBeInstanceOf(Date);
    expect(lastUpdate.data.replacedById).toBe("rt-child");

    // Child create call carries parentId+familyId from the parent row.
    const createCalls = (prisma.refreshToken.create as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const createArg = createCalls.at(-1)?.[0] as { data: { parentId: string; familyId: string } };
    expect(createArg.data.parentId).toBe("rt-parent");
    expect(createArg.data.familyId).toBe("fam-1");

    // The SELECT used FOR UPDATE.
    const queryCalls = (prisma.$queryRaw as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(queryCalls.length).toBeGreaterThanOrEqual(1);
    // $queryRaw is a tagged template; the first arg is the TemplateStringsArray.
    // Stringify all of it to grep for FOR UPDATE.
    const sql = String(queryCalls[0]?.[0] ?? "");
    expect(sql.toUpperCase()).toContain("FOR UPDATE");
  });
});
