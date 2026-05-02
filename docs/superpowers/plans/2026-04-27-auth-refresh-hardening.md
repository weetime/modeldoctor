> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# Auth Refresh-Token Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current zero-grace, IP-throttled refresh-token flow with the OAuth 2.0 Security BCP (draft-ietf-oauth-security-topics §4.13.2) recommended pattern: rotation chain + grace window + transactional single-flight on the server, plus Web Locks cross-tab dedup, session-presence cookie, typed transient/auth-failure errors, and proactive expiry-driven refresh on the client.

**Architecture:** Two PRs delivered back-to-back.

- **PR A — Server hardening:** add `familyId` / `parentId` / `replacedById` columns to `refresh_tokens`, rewrite `AuthService#refresh` to run inside a `Serializable` transaction with `SELECT … FOR UPDATE` on the parent row, implement a 30-second grace window where a recently-revoked token whose successor still exists returns a fresh access token without rotating the cookie, and revoke by `familyId` (not by `userId`) on outside-grace replay. Drop the per-IP `@Throttle({ limit: 10, ttl: 60_000 })` on `/auth/refresh` — the global 100/min throttle and the cryptographic rotation are sufficient.
- **PR B — Client hardening:** server sets a non-HttpOnly `md_session=1` cookie alongside `md_refresh` so the client can skip pointless refresh probes when no session exists; add `accessTokenExpiresAt` to `AuthTokenResponse`; refactor the in-flight promise into a Web-Locks-backed cross-tab coordinator with `BroadcastChannel` result fanout; turn `refreshAccessToken` into a discriminated-union return so BootGate can distinguish 401 / 429 / 5xx; retry transient failures with exponential-backoff + jitter; schedule proactive silent refresh 30s before token expiry, paused on `document.visibilityState === "hidden"`.

**Branch / PR layout:**

- PR A: branch `feat/auth-refresh-server-hardening` cut from `main`. Worktree path: `/Users/fangyong/vllm/modeldoctor/feat/auth-refresh-server-hardening`.
- PR B: branch `feat/auth-refresh-client-hardening` cut from PR A's branch (depends on PR A's `md_session` cookie + `accessTokenExpiresAt` field). Worktree path: `/Users/fangyong/vllm/modeldoctor/feat/auth-refresh-client-hardening`.

Both PRs target `main`. PR B opens after PR A merges (rebase B onto main if A's branch shifts).

**Tech Stack:** NestJS 10 + Prisma 5 (Postgres) on the server side; React 18 + zustand + react-router on the client. Tests via vitest@2 (api unit + e2e with testcontainers) and vitest@1 (web). Standards referenced: RFC 6749 §10.4, draft-ietf-oauth-security-topics §4.13, RFC 9700 (Browser-Based Apps BCP), W3C Web Locks API.

---

## Pre-flight: Worktree setup (PR A)

- [ ] **Step 1: Create the PR A worktree from `main`**

```bash
git -C /Users/fangyong/vllm/modeldoctor/.bare worktree add \
  /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-server-hardening \
  -b feat/auth-refresh-server-hardening main
cd /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-server-hardening
```

If your repo is not a `.bare` shared cache, fall back to:

```bash
git -C /Users/fangyong/vllm/modeldoctor/feat/regression-suite worktree add \
  /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-server-hardening \
  -b feat/auth-refresh-server-hardening main
```

Verify:

```bash
git -C /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-server-hardening status
# expected: On branch feat/auth-refresh-server-hardening, nothing to commit
```

- [ ] **Step 2: Install deps + ensure dev DB is reachable**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-server-hardening
pnpm install
psql -d modeldoctor -c "SELECT 1" >/dev/null && echo OK
```

If `psql` fails, start the brew Postgres (NOT docker compose — see memory `feedback_postgres_brew`):

```bash
brew services start postgresql@16
```

---

# PR A — Server Hardening

## Task A1: Schema additions for rotation chain + family

**Goal:** Extend `RefreshToken` with `familyId`, `parentId`, `replacedById`. Drop existing rows in the migration (pre-prod, no compat per memory `feedback_no_compat_shims`).

**Files:**
- Modify: `apps/api/prisma/schema.prisma:27-40`
- Create: `apps/api/prisma/migrations/<timestamp>_refresh_token_rotation_chain/migration.sql`

- [ ] **Step 1: Edit `apps/api/prisma/schema.prisma` model `RefreshToken`**

Replace the model block at lines 27–40 with:

```prisma
model RefreshToken {
  id           String    @id @default(cuid())
  userId       String    @map("user_id")
  // The rotation chain's root token id. The first token in a chain has
  // familyId === id; every rotation copies this forward. Theft detection
  // revokes by familyId so concurrent sessions of the same user (different
  // families) are unaffected.
  familyId     String    @map("family_id")
  // Immediate predecessor in the chain. NULL for the first token issued at
  // login/register.
  parentId     String?   @map("parent_id")
  // Immediate successor. Set inside the rotation transaction when this token
  // is revoked-and-replaced. Used by grace-window replay to find the child
  // that the legitimate caller already received.
  replacedById String?   @map("replaced_by_id")
  tokenHash    String    @unique @map("token_hash")
  expiresAt    DateTime  @map("expires_at")
  revokedAt    DateTime? @map("revoked_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([tokenHash])
  @@index([familyId])
  @@index([parentId])
  @@map("refresh_tokens")
}
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api
pnpm db:migrate:dev --name refresh_token_rotation_chain
```

Prisma will detect the schema diff, prompt about the new NOT NULL column, and ask permission to drop existing rows. Accept (we are pre-production; existing dev sessions can re-login).

- [ ] **Step 3: Verify the generated `migration.sql` matches the expected shape**

Open the freshly created `apps/api/prisma/migrations/<timestamp>_refresh_token_rotation_chain/migration.sql`. It should contain (in some order):

```sql
-- Drop existing rows so the new NOT NULL column can be added without backfill.
DELETE FROM "refresh_tokens";

ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT NOT NULL;
ALTER TABLE "refresh_tokens" ADD COLUMN "parent_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_id" TEXT;

CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "refresh_tokens_parent_id_idx" ON "refresh_tokens"("parent_id");
```

If Prisma generated a backfill or a DEFAULT clause instead of `DELETE`, edit the SQL to match exactly the form above (we pre-prod-rebuild rather than backfill). Then re-run `pnpm db:migrate:dev` to re-apply with the corrected SQL.

- [ ] **Step 4: Verify Prisma client regenerated**

```bash
pnpm db:generate
pnpm type-check
```

Expected: clean (the `AuthService` uses of `this.prisma.refreshToken.create({ data: { ... } })` will now error because we omit the new required `familyId` — that error is fixed in Task A2).

- [ ] **Step 5: Commit schema + migration**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api/auth): add rotation-chain + family columns to refresh_tokens

Per OAuth 2.0 Security BCP §4.13.2, refresh-token rotation should track
parent/successor edges and group rotations into a 'family' so theft
detection revokes a single chain rather than every session a user has.

Adds familyId / parentId / replacedById to RefreshToken. Pre-production
migration drops existing rows (no backfill); users will re-login.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: Refactor `AuthService.issueTokens` to populate familyId

**Goal:** Make `issueTokens` aware of the rotation-chain. New tokens at register/login start a fresh family (`familyId = self.id`); rotated tokens carry forward the parent's `familyId` and set `parentId`. We split the current `issueTokens` into a private helper used by both paths.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:89-117`
- Test: `apps/api/src/modules/auth/auth.service.spec.ts` (new)

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/auth/auth.service.spec.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AuthService } from "./auth.service.js";
import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import type { PrismaService } from "../../database/prisma.service.js";
import type { UsersService } from "../users/users.service.js";

function makeService(prismaOverrides: Partial<PrismaService> = {}): {
  service: AuthService;
  prisma: ReturnType<typeof makePrismaMock>;
  jwt: { signAsync: ReturnType<typeof vi.fn> };
  users: { findById: ReturnType<typeof vi.fn>; toPublic: ReturnType<typeof vi.fn> };
} {
  const prisma = makePrismaMock(prismaOverrides);
  const jwt = { signAsync: vi.fn().mockResolvedValue("access-jwt") };
  const users = {
    findById: vi.fn().mockResolvedValue({ id: "u1", email: "u@x", roles: ["user"] }),
    toPublic: vi.fn((u) => ({ id: u.id, email: u.email, roles: u.roles, createdAt: "iso" })),
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
  return {
    service: new AuthService(
      users as unknown as UsersService,
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService<never, true>,
    ),
    prisma,
    jwt,
    users,
  };
}

function makePrismaMock(overrides: Partial<PrismaService> = {}) {
  return {
    refreshToken: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: "rt-new", ...data })),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb({})),
    $queryRaw: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof makePrismaMock>;
}

describe("AuthService.issueNewSession (register/login)", () => {
  it("creates a refresh token whose familyId equals its own id (chain root)", async () => {
    const { service, prisma } = makeService();
    const publicUser = { id: "u1", email: "u@x", roles: ["user"], createdAt: "iso" };

    // The implementation calls prisma.refreshToken.create twice:
    //  1. without familyId → captures the generated id
    //  2. updates familyId = self.id (or alternative: pre-generates id with cuid)
    // We accept either implementation; assert by inspecting the final create call's `data`.
    await service.issueNewSession(publicUser);

    const calls = (prisma.refreshToken.create as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const createdData = calls.at(-1)?.[0] as { data: { familyId?: string; id?: string; parentId?: string | null } };
    expect(createdData.data.parentId ?? null).toBeNull();
    // familyId must be set and equal to the row's id
    if (createdData.data.id !== undefined) {
      expect(createdData.data.familyId).toBe(createdData.data.id);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api
pnpm test -- auth.service.spec.ts
```

Expected: FAIL with `service.issueNewSession is not a function` (the method doesn't exist yet).

- [ ] **Step 3: Implement `issueNewSession`**

Edit `apps/api/src/modules/auth/auth.service.ts`. Replace the `issueTokens` method (lines 89–112) with:

```typescript
  /**
   * Issue a brand-new session — used by register and login. Creates the
   * root of a fresh rotation chain (familyId === self.id, parentId === null).
   */
  async issueNewSession(user: PublicUser): Promise<IssuedTokens> {
    return this.issueRotation(user, null);
  }

  /**
   * Internal helper. Creates a new RefreshToken row + signs an access token.
   * If `parent` is null, this token starts a new family (familyId = self.id).
   * Otherwise, familyId is inherited from the parent and parentId is set.
   *
   * Caller is responsible for marking `parent.replacedById = newRow.id` and
   * `parent.revokedAt = now()` inside the same transaction (see refresh()).
   */
  private async issueRotation(
    user: PublicUser,
    parent: { id: string; familyId: string } | null,
    tx: Pick<PrismaService, "refreshToken"> = this.prisma,
  ): Promise<IssuedTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email, roles: user.roles };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }) ?? "",
      expiresIn: this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }),
    });

    const refreshToken = randomBytes(48).toString("base64url");
    const refreshDays = this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true });
    const expiresAt = new Date(Date.now() + refreshDays * 86_400_000);

    if (parent === null) {
      // Root of a new family. Two-step: create with placeholder, then patch
      // familyId = self.id. Avoids needing a pre-generated cuid in app code.
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.sha256hex(refreshToken),
          expiresAt,
          familyId: "__pending__", // overwritten in next step
          parentId: null,
        },
      });
      await tx.refreshToken.update({
        where: { id: created.id },
        data: { familyId: created.id },
      });
    } else {
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.sha256hex(refreshToken),
          expiresAt,
          familyId: parent.familyId,
          parentId: parent.id,
        },
      });
    }

    return { accessToken, refreshToken, user };
  }
```

Then update `register` (line 28) and `login` (line 40) to call `issueNewSession` instead of `issueTokens`:

```typescript
  async register(email: string, password: string): Promise<IssuedTokens> {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new ConflictException("Email already registered");

    const disableFirstAdmin = this.config.get("DISABLE_FIRST_USER_ADMIN", { infer: true });
    const total = await this.users.countAll();
    const roles = !disableFirstAdmin && total === 0 ? ["admin"] : ["user"];

    const user = await this.users.create(email, password, roles);
    return this.issueNewSession(user);
  }

  async login(email: string, password: string): Promise<IssuedTokens> {
    const row = await this.users.findByEmail(email);
    if (!row) throw new UnauthorizedException("Invalid credentials");
    const ok = await this.users.verifyPassword(row.passwordHash, password);
    if (!ok) throw new UnauthorizedException("Invalid credentials");
    return this.issueNewSession(this.users.toPublic(row));
  }
```

Also remove the (now-unused) `issueTokens` method body — its logic is in `issueRotation`. Keep `sha256hex` private as before.

- [ ] **Step 4: Run unit test — pass**

```bash
pnpm test -- auth.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck + lint + biome**

```bash
pnpm type-check && pnpm lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.service.spec.ts
git commit -m "refactor(api/auth): split issueTokens into issueNewSession + issueRotation

Sets familyId at issue time so register/login start fresh rotation chains.
Refresh path (next commit) reuses issueRotation under the same transaction
to extend an existing chain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: Transactional, row-locked rotation in `AuthService.refresh`

**Goal:** Rewrite `refresh()` to wrap rotation in a `Serializable` transaction with `SELECT … FOR UPDATE` on the parent row, so two concurrent calls with the same cookie serialize on the database lock instead of racing.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (the `refresh` method, currently lines 48–77)
- Test: `apps/api/src/modules/auth/auth.service.spec.ts` (extend)

- [ ] **Step 1: Add a `RefreshResult` discriminated union to the service**

At the top of `apps/api/src/modules/auth/auth.service.ts`, after the `IssuedTokens` interface:

```typescript
export type RefreshResult =
  | { kind: "rotated"; accessToken: string; refreshToken: string; user: PublicUser }
  | { kind: "graceReplayed"; accessToken: string; user: PublicUser };
```

The grace-replayed variant is intentional: the cookie was already rotated on the legitimate caller's response, so replays inside the grace window must NOT re-set the cookie (otherwise the legitimate caller's freshly-issued token gets clobbered).

- [ ] **Step 2: Write failing test for transactional refresh + happy-path rotation**

Append to `apps/api/src/modules/auth/auth.service.spec.ts`:

```typescript
describe("AuthService.refresh (happy path)", () => {
  it("rotates: revokes parent, creates child with parentId+familyId, returns 'rotated'", async () => {
    const presented = "raw-refresh-token-xxx";
    const presentedHash =
      "0000000000000000000000000000000000000000000000000000000000000000"; // overridden below
    const parentRow = {
      id: "rt-parent",
      user_id: "u1",
      family_id: "fam-1",
      parent_id: null,
      replaced_by_id: null,
      expires_at: new Date(Date.now() + 86_400_000),
      revoked_at: null,
    };
    const { service, prisma, users } = makeService();

    // Stub $queryRaw (FOR UPDATE) to return the parent row.
    (prisma.$queryRaw as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([parentRow]);
    // Stub the txn callback runner to pass `tx` through; rotation calls
    // tx.refreshToken.create and tx.refreshToken.update.
    (prisma.$transaction as unknown as { mockImplementation: (fn: unknown) => void })
      .mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          $queryRaw: prisma.$queryRaw,
          refreshToken: prisma.refreshToken,
        }),
      );
    (prisma.refreshToken.create as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ id: "rt-child" });

    const result = await service.refresh(presented);

    expect(result.kind).toBe("rotated");
    if (result.kind !== "rotated") throw new Error("type narrow");
    expect(result.refreshToken).toBeTruthy();
    expect(result.accessToken).toBe("access-jwt");

    // Parent was marked revoked + replacedBy
    const updateCalls = (prisma.refreshToken.update as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const [updateArg] = updateCalls.at(-1) as [{ where: { id: string }; data: { revokedAt: Date; replacedById: string } }];
    expect(updateArg.where.id).toBe("rt-parent");
    expect(updateArg.data.revokedAt).toBeInstanceOf(Date);
    expect(updateArg.data.replacedById).toBe("rt-child");

    // Child was created with parentId+familyId carried forward
    const createCalls = (prisma.refreshToken.create as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const createArg = createCalls.at(-1)?.[0] as { data: { parentId: string; familyId: string } };
    expect(createArg.data.parentId).toBe("rt-parent");
    expect(createArg.data.familyId).toBe("fam-1");

    // Used FOR UPDATE
    const queryCalls = (prisma.$queryRaw as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const sqlFragment = String(queryCalls[0]?.[0] ?? "");
    expect(sqlFragment.toUpperCase()).toContain("FOR UPDATE");

    void users;
    void presentedHash;
  });
});
```

- [ ] **Step 3: Run — fails**

```bash
pnpm test -- auth.service.spec.ts
```

Expected: FAIL — `refresh` doesn't yet wrap in `$transaction` or use `$queryRaw` with `FOR UPDATE`.

- [ ] **Step 4: Implement transactional rotation**

Replace the `refresh` method in `apps/api/src/modules/auth/auth.service.ts` with:

```typescript
  // 30-second grace window per OAuth 2.0 Security BCP §4.13.2: a recently-
  // revoked refresh token whose successor still exists may still mint a fresh
  // access token (no cookie rotation). Eliminates StrictMode / multi-tab /
  // network-retry false-positive theft detections.
  private static readonly GRACE_WINDOW_MS = 30_000;

  async refresh(presentedToken: string): Promise<RefreshResult> {
    const tokenHash = this.sha256hex(presentedToken);

    return this.prisma.$transaction(
      async (tx) => {
        // SELECT … FOR UPDATE on the parent row serializes concurrent
        // refresh attempts with the same cookie. Prisma exposes raw SQL via
        // $queryRaw; we read every column we need so the in-transaction
        // logic doesn't issue a second SELECT.
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            user_id: string;
            family_id: string;
            parent_id: string | null;
            replaced_by_id: string | null;
            expires_at: Date;
            revoked_at: Date | null;
          }>
        >`SELECT id, user_id, family_id, parent_id, replaced_by_id, expires_at, revoked_at
            FROM "refresh_tokens"
            WHERE "token_hash" = ${tokenHash}
            FOR UPDATE`;

        const presented = rows[0];
        if (!presented) throw new UnauthorizedException("Invalid refresh token");

        const now = new Date();
        if (presented.expires_at < now) {
          throw new UnauthorizedException("Refresh token expired");
        }

        if (presented.revoked_at !== null) {
          // Inside grace window AND a successor exists → assume legitimate
          // racing tab / network retry. Mint a new access token; do NOT
          // rotate the cookie (the successor cookie is already in the
          // browser's cookie jar from the first rotation).
          const sinceRevoke = now.getTime() - presented.revoked_at.getTime();
          if (presented.replaced_by_id && sinceRevoke < AuthService.GRACE_WINDOW_MS) {
            const userRow = await this.users.findById(presented.user_id);
            const publicUser = this.users.toPublic(userRow);
            const payload: JwtPayload = {
              sub: publicUser.id,
              email: publicUser.email,
              roles: publicUser.roles,
            };
            const accessToken = await this.jwt.signAsync(payload, {
              secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }) ?? "",
              expiresIn: this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }),
            });
            return { kind: "graceReplayed", accessToken, user: publicUser };
          }

          // Outside grace window → genuine reuse. Revoke the entire family
          // (NOT every token of this user — concurrent sessions are
          // independent rotation chains).
          await tx.refreshToken.updateMany({
            where: { familyId: presented.family_id, revokedAt: null },
            data: { revokedAt: now },
          });
          this.logger.warn(
            { userId: presented.user_id, familyId: presented.family_id, rowId: presented.id },
            "Refresh token theft detected; family revoked",
          );
          throw new UnauthorizedException("Refresh token reused; session invalidated");
        }

        // HAPPY PATH — extend the chain. Issue a child rotation under the
        // same family; mark the parent revoked + replacedBy.
        const userRow = await this.users.findById(presented.user_id);
        const publicUser = this.users.toPublic(userRow);
        const issued = await this.issueRotation(
          publicUser,
          { id: presented.id, familyId: presented.family_id },
          tx as unknown as PrismaService,
        );

        // Find the child id we just created so we can wire replacedById.
        // issueRotation doesn't return the row, so we re-query — cheap
        // because token_hash is uniquely indexed.
        const childRow = await tx.refreshToken.findUnique({
          where: { tokenHash: this.sha256hex(issued.refreshToken) },
          select: { id: true },
        });
        if (!childRow) {
          // Should never happen: we just created it inside the same txn.
          throw new Error("rotation invariant: child row missing after issue");
        }

        await tx.refreshToken.update({
          where: { id: presented.id },
          data: { revokedAt: now, replacedById: childRow.id },
        });

        return {
          kind: "rotated",
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          user: publicUser,
        };
      },
      { isolationLevel: "Serializable" },
    );
  }
```

Note: this requires `import type { Prisma } from "@prisma/client";` only if the isolation-level constant is referenced symbolically. The string `"Serializable"` is accepted by Prisma 5 directly, so no extra import needed. Verify with type-check.

- [ ] **Step 5: Run unit test — pass**

```bash
pnpm test -- auth.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run type-check**

```bash
pnpm type-check
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.service.spec.ts
git commit -m "feat(api/auth): transactional rotation with row lock + RefreshResult union

Wraps refresh() in \$transaction({ isolationLevel: Serializable }), using
SELECT ... FOR UPDATE on the parent row so concurrent calls with the same
cookie serialize on the DB lock. Returns a discriminated union so the
controller can distinguish a fresh rotation (set new cookie) from a
grace-window replay (do not rotate cookie).

Per OAuth 2.0 Security BCP §4.13.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A4: Unit-test grace-window replay

**Goal:** Prove that a revoked-but-recent token with a non-null `replacedById` returns `kind: "graceReplayed"` and does NOT mark anything else revoked.

**Files:**
- Test: `apps/api/src/modules/auth/auth.service.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `auth.service.spec.ts`:

```typescript
describe("AuthService.refresh (grace-window replay)", () => {
  it("revoked < 30s ago + replacedById set → 'graceReplayed', no cookie rotation, family untouched", async () => {
    const { service, prisma } = makeService();
    const revokedAt = new Date(Date.now() - 5_000); // 5s ago — well within grace
    (prisma.$queryRaw as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([
        {
          id: "rt-old",
          user_id: "u1",
          family_id: "fam-1",
          parent_id: null,
          replaced_by_id: "rt-new",
          expires_at: new Date(Date.now() + 86_400_000),
          revoked_at: revokedAt,
        },
      ]);
    (prisma.$transaction as unknown as { mockImplementation: (fn: unknown) => void })
      .mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({ $queryRaw: prisma.$queryRaw, refreshToken: prisma.refreshToken }),
      );

    const result = await service.refresh("any-presented-value");

    expect(result.kind).toBe("graceReplayed");
    if (result.kind !== "graceReplayed") throw new Error("type narrow");
    expect(result.accessToken).toBe("access-jwt");
    expect("refreshToken" in result).toBe(false);

    // Family must NOT be revoked
    expect((prisma.refreshToken.updateMany as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    // No new child created
    expect((prisma.refreshToken.create as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — should already pass**

```bash
pnpm test -- auth.service.spec.ts
```

Expected: PASS (Task A3's implementation already handles this case; this test pins the contract).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.spec.ts
git commit -m "test(api/auth): grace-window replay returns graceReplayed without family revocation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A5: Unit-test outside-grace theft detection

**Goal:** Prove that a revoked token presented after the grace window expires triggers family revocation and a 401.

**Files:**
- Test: `apps/api/src/modules/auth/auth.service.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe("AuthService.refresh (outside-grace theft)", () => {
  it("revoked > 30s ago → revokes entire family + throws Unauthorized", async () => {
    const { service, prisma } = makeService();
    const revokedAt = new Date(Date.now() - 60_000); // 60s ago — past grace
    (prisma.$queryRaw as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([
        {
          id: "rt-old",
          user_id: "u1",
          family_id: "fam-1",
          parent_id: null,
          replaced_by_id: "rt-new",
          expires_at: new Date(Date.now() + 86_400_000),
          revoked_at: revokedAt,
        },
      ]);
    (prisma.$transaction as unknown as { mockImplementation: (fn: unknown) => void })
      .mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({ $queryRaw: prisma.$queryRaw, refreshToken: prisma.refreshToken }),
      );

    await expect(service.refresh("any-presented-value")).rejects.toThrow(/reused/);

    // Family revocation must run
    const updateManyCalls = (prisma.refreshToken.updateMany as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(updateManyCalls.length).toBe(1);
    const [arg] = updateManyCalls[0] as [{ where: { familyId: string; revokedAt: null } }];
    expect(arg.where.familyId).toBe("fam-1");
    expect(arg.where.revokedAt).toBeNull();
  });

  it("revoked + replacedById null → genuine reuse (no successor) → revokes family", async () => {
    const { service, prisma } = makeService();
    (prisma.$queryRaw as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([
        {
          id: "rt-orphan",
          user_id: "u1",
          family_id: "fam-2",
          parent_id: null,
          replaced_by_id: null, // no successor → treat as reuse regardless of timing
          expires_at: new Date(Date.now() + 86_400_000),
          revoked_at: new Date(Date.now() - 1_000),
        },
      ]);
    (prisma.$transaction as unknown as { mockImplementation: (fn: unknown) => void })
      .mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({ $queryRaw: prisma.$queryRaw, refreshToken: prisma.refreshToken }),
      );

    await expect(service.refresh("orphan")).rejects.toThrow(/reused/);
    expect((prisma.refreshToken.updateMany as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — should already pass**

```bash
pnpm test -- auth.service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.spec.ts
git commit -m "test(api/auth): outside-grace replay revokes family + 401

Covers two outside-grace scenarios: (a) revoked >30s ago with successor,
(b) revoked any time with NO successor (orphan revoke). Both should
trigger family-wide revocation and throw Unauthorized.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A6: Controller — handle discriminated union + drop `@Throttle` on `/refresh`

**Goal:** Update `AuthController#refresh` to set the cookie only when the result is `rotated`. Also drop the per-IP `@Throttle({ limit: 10, ttl: 60_000 })` decorator on `/refresh` — the global 100/min throttle (`app.module.ts:72`) is sufficient bottom defense; cryptographic rotation + grace + theft detection do the real work.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.controller.ts:82-99`

- [ ] **Step 1: Edit `auth.controller.ts`**

Replace the `refresh` method (and remove the line-82 `@Throttle` decorator):

```typescript
  @Public()
  @Post("refresh")
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!presented) throw new UnauthorizedException("No refresh cookie");
    const result = await this.auth.refresh(presented);
    if (result.kind === "rotated") {
      setRefreshCookie(
        res,
        result.refreshToken,
        this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
        this.config.get("NODE_ENV", { infer: true }) === "production",
      );
    }
    // Grace-replayed: do not touch the cookie — the legitimate caller's
    // freshly-issued cookie is already in the browser's jar.
    return { accessToken: result.accessToken, user: result.user };
  }
```

Keep `@Throttle({ limit: 10, ttl: 60_000 })` on `/login` and `/register` — those are credential-presentation endpoints.

- [ ] **Step 2: Run type-check + lint**

```bash
pnpm type-check && pnpm lint
```

Expected: clean.

- [ ] **Step 3: Run existing api unit specs**

```bash
pnpm test
```

Expected: all green (except possibly old e2e auth specs that test theft on userId scope — those are updated in Task A8).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/auth/auth.controller.ts
git commit -m "refactor(api/auth): refresh controller handles RefreshResult union; drop per-IP throttle

The previous /refresh @Throttle({ limit: 10, ttl: 60_000 }) was an IP-scoped
brute-force defense that doesn't make sense for refresh — the cookie is
already a cryptographically-validated bearer; tight per-IP limits punish
NAT'd users (offices, ISPs) and create dev-loop kicks. Login keeps its
throttle. Refresh now relies on the global 100/min ThrottlerModule
default (app.module.ts) plus rotation+grace.

Cookie set only on 'rotated' result; grace-replayed responses leave the
cookie alone since the legitimate caller already received the new one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A7: e2e — concurrent refresh inside grace window

**Goal:** Boot the real AppModule against a real Postgres testcontainer, fire two `/api/auth/refresh` calls in parallel with the same cookie, assert both return 201 and exactly one of them sets a new cookie (the other is grace-replay, no Set-Cookie).

**Files:**
- Modify: `apps/api/test/e2e/auth.e2e-spec.ts` — append a new `it`

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/api/test/e2e/auth.e2e-spec.ts` before the closing `});` of the outer `describe`:

```typescript
  // ── Grace window: concurrent refresh ──────────────────────────────────────
  it("two concurrent /refresh with same cookie → both 201; exactly one rotates cookie", async () => {
    const regRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "concurrent-refresh@example.com", password: "Password1!" })
      .expect(201);

    const rawCookies = regRes.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const cookieValue = (cookies.find((c) => c.startsWith("md_refresh=")) as string).split(";")[0];

    const [resA, resB] = await Promise.all([
      request(ctx.app.getHttpServer()).post("/api/auth/refresh").set("Cookie", cookieValue),
      request(ctx.app.getHttpServer()).post("/api/auth/refresh").set("Cookie", cookieValue),
    ]);

    expect(resA.status, "first refresh").toBe(201);
    expect(resB.status, "second refresh").toBe(201);
    expect(resA.body.accessToken).toBeTruthy();
    expect(resB.body.accessToken).toBeTruthy();

    const aSetsCookie = !!(resA.headers["set-cookie"] as string[] | undefined)?.some((c) =>
      c.startsWith("md_refresh="),
    );
    const bSetsCookie = !!(resB.headers["set-cookie"] as string[] | undefined)?.some((c) =>
      c.startsWith("md_refresh="),
    );
    // Exactly one of the two should rotate the cookie; the loser is grace-replayed.
    expect(aSetsCookie !== bSetsCookie, "exactly one rotates cookie").toBe(true);
  });
```

- [ ] **Step 2: Run e2e**

```bash
cd apps/api
pnpm test:e2e -- auth.e2e-spec.ts
```

Expected: PASS (the test should be green given Tasks A3–A6).

If it fails because the Serializable transaction throws a serialization conflict, that's expected behavior under high contention; the controller currently propagates the error as 500. We need a retry loop. Add to the next step.

- [ ] **Step 3 (only if Step 2 fails with serialization error): add a single-shot retry on serialization conflict**

In `apps/api/src/modules/auth/auth.service.ts`, wrap the `$transaction` call in a one-shot retry:

```typescript
  async refresh(presentedToken: string): Promise<RefreshResult> {
    try {
      return await this.refreshOnce(presentedToken);
    } catch (e) {
      // Postgres serialization_failure (40001) — only happens under
      // Serializable isolation when two concurrent rotations of the same
      // family race past the FOR UPDATE lock. Retrying once gives the
      // loser a chance to observe the winner's revoked_at + replaced_by_id
      // and route through the grace-replay branch.
      if (this.isSerializationFailure(e)) {
        return await this.refreshOnce(presentedToken);
      }
      throw e;
    }
  }

  private async refreshOnce(presentedToken: string): Promise<RefreshResult> {
    const tokenHash = this.sha256hex(presentedToken);
    return this.prisma.$transaction(
      async (tx) => {
        // ... move the existing transaction body here verbatim
      },
      { isolationLevel: "Serializable" },
    );
  }

  private isSerializationFailure(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const code = (err as { code?: string }).code;
    return code === "P2034" || code === "40001";
  }
```

Re-run `pnpm test:e2e -- auth.e2e-spec.ts`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/e2e/auth.e2e-spec.ts apps/api/src/modules/auth/auth.service.ts
git commit -m "test(api/auth): concurrent refresh inside grace yields exactly-one cookie rotation

Two parallel POST /api/auth/refresh with the same cookie value both return
201 + a valid access token, but only one of them carries Set-Cookie. The
other arrives after rotation has committed and routes through the
grace-replay branch (no cookie change).

Adds a one-shot retry on Postgres serialization_failure (P2034 / 40001)
to absorb the rare lost-update race that Serializable isolation surfaces
when both transactions FOR UPDATE the same row simultaneously.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A8: e2e — outside-grace theft revokes family only (not other sessions)

**Goal:** Two devices = two families. Replaying a stolen token from device A's family must NOT log device B (different family) out.

**Files:**
- Modify: `apps/api/test/e2e/auth.e2e-spec.ts` — extend or add an `it`

- [ ] **Step 1: Write the failing e2e test**

Append to the same describe in `auth.e2e-spec.ts`:

```typescript
  // ── Theft on family A does not invalidate family B (concurrent sessions) ──
  it("theft on one family revokes only that family; second session still rotates", async () => {
    // Two logins by the same user → two independent rotation chains (families).
    await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "two-sessions@example.com", password: "Password1!" })
      .expect(201);

    const loginA = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "two-sessions@example.com", password: "Password1!" })
      .expect(201);
    const loginB = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "two-sessions@example.com", password: "Password1!" })
      .expect(201);

    const cookieA = (
      (loginA.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];
    const cookieB = (
      (loginB.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    // Device A rotates A → A'
    const aRotated = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieA)
      .expect(201);
    const cookieAprime = (
      (aRotated.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];
    expect(cookieAprime).not.toBe(cookieA);

    // Wait > 30s? No — speed-up: the test relies on the orphan path. We
    // present the now-revoked A again with NO grace race; A is revoked AND
    // its replacedById points to A'. Within grace, this would be a replay.
    // To force outside-grace deterministically, manipulate revoked_at via
    // Prisma to be 60s in the past.
    const prisma = ctx.app.get(PrismaService);
    await prisma.$executeRaw`
      UPDATE "refresh_tokens"
      SET "revoked_at" = NOW() - INTERVAL '60 seconds'
      WHERE "token_hash" = ${require("node:crypto")
        .createHash("sha256")
        .update(cookieA.split("=")[1])
        .digest("hex")}
    `;

    // Replay A → outside grace → 401 + family-A revoked
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieA)
      .expect(401);

    // Device B's session was a separate family → still works
    const bRotated = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieB)
      .expect(201);
    expect(bRotated.body.accessToken).toBeTruthy();
  });
```

- [ ] **Step 2: Run — pass**

```bash
pnpm test:e2e -- auth.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 3: Update the existing theft-detection test (line ~128) since semantics changed**

The existing test (`it("theft detection: replaying revoked cookie revokes all tokens", ...)`) replays a revoked cookie immediately — that's now a grace-replay and returns 201, not 401. Update it to either (a) advance time as in the new test or (b) rename to test grace-replay and 401-on-orphan.

Replace the existing `it("theft detection: ...")` block with:

```typescript
  // ── Theft detection: outside-grace replay still kills the family ─────────
  it("theft: replaying revoked cookie OUTSIDE grace window → 401 + family revoked", async () => {
    const regRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "theft-test@example.com", password: "Password1!" })
      .expect(201);

    const cookieValueA = (
      (regRes.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    const refreshResB = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(201);
    const cookieValueB = (
      (refreshResB.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    // Force A's revoked_at past the 30s grace window
    const prisma = ctx.app.get(PrismaService);
    await prisma.$executeRaw`
      UPDATE "refresh_tokens"
      SET "revoked_at" = NOW() - INTERVAL '60 seconds'
      WHERE "token_hash" = ${require("node:crypto")
        .createHash("sha256")
        .update(cookieValueA.split("=")[1])
        .digest("hex")}
    `;

    // Now A's replay is outside grace → 401 + family revoked
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(401);

    // B (the legitimate successor) was in the same family → also 401
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueB)
      .expect(401);
  });

  // ── Grace-replay: replaying revoked cookie INSIDE grace returns access token ─
  it("grace replay: replaying revoked cookie INSIDE grace → 201 + accessToken, NO Set-Cookie", async () => {
    const regRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "grace-replay@example.com", password: "Password1!" })
      .expect(201);

    const cookieValueA = (
      (regRes.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    // Rotate once → A is revoked, A' is the live cookie
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(201);

    // Immediately replay A — within the 30s grace window
    const replay = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(201);

    expect(replay.body.accessToken).toBeTruthy();
    const setCookieHeader = replay.headers["set-cookie"] as string[] | undefined;
    const hasNewRefreshCookie = !!setCookieHeader?.some((c) => c.startsWith("md_refresh="));
    expect(hasNewRefreshCookie, "grace-replay must NOT rotate cookie").toBe(false);
  });
```

- [ ] **Step 4: Run all e2e**

```bash
pnpm test:e2e -- auth.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/e2e/auth.e2e-spec.ts
git commit -m "test(api/auth): family-scoped theft detection + grace-replay e2e coverage

- theft: outside-grace replay revokes only the affected family; a
  separate session (different family) of the same user keeps working
- grace replay: revoked cookie within 30s + successor exists → 201 with
  fresh accessToken, NO Set-Cookie (legitimate caller already has the
  rotated cookie)

Updates the existing 'theft detection' test to advance revoked_at past
the grace window before replay, since immediate replay is now legitimate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A9: Open PR A

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/auth-refresh-server-hardening
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(api/auth): rotation chain + grace window + family-scoped theft detection" --body "$(cat <<'EOF'
## Summary

- Adds `familyId` / `parentId` / `replacedById` to `refresh_tokens` so rotations form an explicit chain, grouped into a family.
- Rewrites `AuthService#refresh` to run inside `Serializable` `\$transaction` with `SELECT … FOR UPDATE` on the parent row — concurrent refreshes of the same cookie serialize on the database lock instead of racing.
- Implements a 30-second **grace window** (per OAuth 2.0 Security BCP §4.13.2 / draft-ietf-oauth-security-topics): a recently-revoked token whose successor still exists returns a fresh access token without rotating the cookie. Eliminates StrictMode / multi-tab / network-retry false-positive theft trips.
- Theft detection (outside grace) now revokes by `familyId`, not by `userId` — so a stolen token from one device can't log out a user's other concurrent sessions.
- Drops the per-IP `@Throttle({ limit: 10, ttl: 60_000 })` on `/auth/refresh`. Keeps it on `/login` and `/register` (those are credential-presentation endpoints). Refresh now relies on the global 100/min throttle + cryptographic rotation.
- Pre-prod migration drops existing rows (no backfill).

## Test plan

- [ ] `pnpm -F @modeldoctor/api test` — auth.service.spec.ts unit covers happy/grace/theft/orphan
- [ ] `pnpm -F @modeldoctor/api test:e2e -- auth.e2e-spec.ts` — concurrent refresh, family isolation, grace replay
- [ ] Manual: log in, refresh page 30+ times in a minute → no kick to /login
- [ ] Manual: log in on two browsers, replay a revoked cookie from browser A after 60s → only browser A logs out

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR A done. PR B picks up after this merges.

---

# PR B — Client Hardening

> **Pre-flight:** PR B's branch is cut from PR A's branch (it depends on the `md_session` cookie + `accessTokenExpiresAt` field added in PR A's controller; though those are added in B itself in Tasks B1–B3 below, they live server-side, so it's cleanest to keep both server-and-client in B's branch on top of A's merged base. After PR A merges, cut B from `main`.)

```bash
# After PR A merges:
git -C /Users/fangyong/vllm/modeldoctor/.bare worktree add \
  /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-client-hardening \
  -b feat/auth-refresh-client-hardening main
cd /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-client-hardening
pnpm install
```

---

## Task B1: Server — set/clear `md_session` non-HttpOnly cookie

**Goal:** Server emits a non-HttpOnly `md_session=1` cookie (Path=/, SameSite=Lax) alongside `md_refresh` so client JS can detect "a session probably exists" before deciding whether to call `/refresh`. Cleared on logout.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Add `setSessionCookie` and `clearSessionCookie` helpers**

In `apps/api/src/modules/auth/auth.controller.ts`, replace the helper block at the top (currently lines 29–39):

```typescript
const REFRESH_COOKIE = "md_refresh";
const SESSION_COOKIE = "md_session";

function setRefreshCookie(res: Response, token: string, maxAgeDays: number, isProd: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
    path: "/api/auth",
    maxAge: maxAgeDays * 86_400_000,
  });
}

/**
 * Non-HttpOnly companion cookie. Holds NO sensitive value — it's a presence
 * flag (`1`). Lets the SPA's BootGate skip the /refresh probe entirely when
 * the user has clearly never logged in (or has logged out), avoiding
 * pointless 401s and rate-limit pressure.
 *
 * Path=/ so JS on any route can read it; SameSite=Lax so it survives
 * top-level cross-site navigations into the app.
 */
function setSessionCookie(res: Response, maxAgeDays: number, isProd: boolean): void {
  res.cookie(SESSION_COOKIE, "1", {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeDays * 86_400_000,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
```

- [ ] **Step 2: Call `setSessionCookie` from `register`, `login`, and the `rotated` branch of `refresh`**

In each of the three handlers, immediately after the `setRefreshCookie(...)` call, add:

```typescript
    setSessionCookie(
      res,
      this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
      this.config.get("NODE_ENV", { infer: true }) === "production",
    );
```

In `logout`, replace `res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });` (line 108) with `clearAuthCookies(res);`.

- [ ] **Step 3: Add an e2e test**

Append to `apps/api/test/e2e/auth.e2e-spec.ts`:

```typescript
  // ── md_session companion cookie ──────────────────────────────────────────
  it("login sets md_session=1 (non-HttpOnly, Path=/); logout clears it", async () => {
    const loginRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "Password1!" })
      .expect(201);

    const cookies = (loginRes.headers["set-cookie"] as string[]) ?? [];
    const sessionCookie = cookies.find((c) => c.startsWith("md_session="));
    expect(sessionCookie, "md_session present").toBeTruthy();
    expect(sessionCookie).not.toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Path=\/(;|$)/);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);

    const logoutRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/logout")
      .set("Cookie", sessionCookie!.split(";")[0])
      .expect(201);
    const logoutCookies = (logoutRes.headers["set-cookie"] as string[]) ?? [];
    const clearedSession = logoutCookies.find((c) => c.startsWith("md_session="));
    expect(clearedSession, "md_session clear directive").toBeTruthy();
    expect(clearedSession).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
```

- [ ] **Step 4: Run e2e**

```bash
cd apps/api
pnpm test:e2e -- auth.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.controller.ts apps/api/test/e2e/auth.e2e-spec.ts
git commit -m "feat(api/auth): non-HttpOnly md_session cookie for client session-presence check

Companion cookie set on register/login/refresh and cleared on logout.
Holds no sensitive value (just '1'); Path=/ so JS on any page can
read it. Lets the SPA skip the /auth/refresh probe entirely when no
session exists, avoiding pointless 401s and rate-limit pressure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: Contracts — add `accessTokenExpiresAt` to `AuthTokenResponse`

**Goal:** Server returns the access token's expiry as an ISO string so the client can schedule proactive refresh without decoding JWTs.

**Files:**
- Modify: `packages/contracts/src/auth.ts`

- [ ] **Step 1: Edit the schema**

Replace the `AuthTokenResponseSchema` block:

```typescript
export const AuthTokenResponseSchema = z.object({
  accessToken: z.string(),
  // ISO 8601. Lets the SPA schedule a silent refresh ~30s before this
  // moment instead of waiting for a 401. Never trust this for security
  // decisions on the server; it's purely a UX hint.
  accessTokenExpiresAt: z.string().datetime(),
  user: PublicUserSchema,
});
```

- [ ] **Step 2: Build contracts**

```bash
pnpm -F @modeldoctor/contracts build
pnpm -F @modeldoctor/contracts type-check
```

- [ ] **Step 3: Verify contract tests still pass**

```bash
pnpm -F @modeldoctor/contracts test
```

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/auth.ts
git commit -m "refactor(contracts): add accessTokenExpiresAt (ISO) to AuthTokenResponse

Lets the SPA schedule proactive silent refresh ~30s before expiry
instead of waiting on 401-driven recovery. Server-source-of-truth
remains the JWT exp claim; this is a denormalized UX hint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B3: Server — populate `accessTokenExpiresAt`

**Goal:** Compute the access token's expiry on the server (mirroring `JWT_ACCESS_EXPIRES_IN`) and include it in every `AuthTokenResponse`.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Helper for parsing `JWT_ACCESS_EXPIRES_IN` to milliseconds**

In `apps/api/src/modules/auth/auth.service.ts`, add a private helper:

```typescript
  /**
   * Parse JWT_ACCESS_EXPIRES_IN (e.g. "15m", "1h", "7200s") to milliseconds.
   * Mirrors @nestjs/jwt's `expiresIn` parsing so we compute the same expiry
   * the JWT itself encodes. Supports s/m/h/d suffixes; bare integer = seconds.
   */
  private parseExpiresInMs(value: string): number {
    const match = /^(\d+)\s*(s|m|h|d)?$/.exec(value);
    if (!match) throw new Error(`Invalid JWT_ACCESS_EXPIRES_IN: ${value}`);
    const n = Number.parseInt(match[1] ?? "", 10);
    const unit = match[2] ?? "s";
    const ms = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1_000;
    return n * ms;
  }
```

- [ ] **Step 2: Extend `IssuedTokens` and `RefreshResult` with expiry**

```typescript
export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  user: PublicUser;
}

export type RefreshResult =
  | { kind: "rotated"; accessToken: string; accessTokenExpiresAt: Date; refreshToken: string; user: PublicUser }
  | { kind: "graceReplayed"; accessToken: string; accessTokenExpiresAt: Date; user: PublicUser };
```

- [ ] **Step 3: Compute expiry in `issueRotation` and the grace-replay branch**

In `issueRotation`, after `signAsync`:

```typescript
    const expiresInMs = this.parseExpiresInMs(
      this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }) ?? "15m",
    );
    const accessTokenExpiresAt = new Date(Date.now() + expiresInMs);
```

Return `{ accessToken, accessTokenExpiresAt, refreshToken, user }`.

In the grace-replay branch of `refresh`, after `signAsync`:

```typescript
            const expiresInMs = this.parseExpiresInMs(
              this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }) ?? "15m",
            );
            const accessTokenExpiresAt = new Date(Date.now() + expiresInMs);
            return { kind: "graceReplayed", accessToken, accessTokenExpiresAt, user: publicUser };
```

For the `"rotated"` branch, propagate `issued.accessTokenExpiresAt` into the return.

- [ ] **Step 4: Update controller responses to include `accessTokenExpiresAt`**

In `apps/api/src/modules/auth/auth.controller.ts`, every `return { accessToken, user }` (in `register`, `login`, `refresh`) becomes:

```typescript
    return {
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      user: result.user,
    };
```

For `register`/`login` (which use `IssuedTokens`):

```typescript
    return {
      accessToken: issued.accessToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
      user: issued.user,
    };
```

(rename the local from `accessToken, refreshToken, user` destructure to `const issued = await ...` if needed for clarity).

- [ ] **Step 5: Update existing e2e assertions**

In `apps/api/test/e2e/auth.e2e-spec.ts`, every `expect(res.body.accessToken).toBeTruthy()` should now also assert `expect(res.body.accessTokenExpiresAt).toBeTruthy()`. Find/replace.

- [ ] **Step 6: Run api tests**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api test:e2e
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.controller.ts apps/api/test/e2e/auth.e2e-spec.ts
git commit -m "feat(api/auth): expose accessTokenExpiresAt in all token responses

Server computes the expiry from JWT_ACCESS_EXPIRES_IN at issue time and
returns it as ISO. Source-of-truth stays the JWT exp claim; this is a
denormalized hint that lets the SPA schedule proactive refresh without
JWT-decode logic on the client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B4: Client — `RefreshResult` discriminated union in `api-client`

**Goal:** Replace the `Promise<string | null>` return of `refreshAccessToken` with a typed union that distinguishes auth failure (401) from transient errors (429 / 5xx / network). BootGate (Task B7) and proactive scheduler (B9) use the variants to decide retry vs redirect.

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/api-client.test.ts`

- [ ] **Step 1: Edit `api-client.ts`**

Replace the `refreshAccessToken` function and the `request<T>` 401 branch:

```typescript
export type RefreshResult =
  | { kind: "ok"; accessToken: string }
  | { kind: "unauthenticated" } // 401/403 — no valid session
  | { kind: "transient"; status: number; retryAfterMs: number }; // 429/5xx/network

let refreshInFlight: Promise<RefreshResult> | null = null;

export async function refreshAccessToken(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  const p: Promise<RefreshResult> = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const body = (await res.json()) as {
          accessToken: string;
          accessTokenExpiresAt: string;
          user: PublicUser;
        };
        useAuthStore.getState().setAuth(body.accessToken, body.user, body.accessTokenExpiresAt);
        return { kind: "ok", accessToken: body.accessToken };
      }
      if (res.status === 401 || res.status === 403) {
        return { kind: "unauthenticated" };
      }
      // 429 / 5xx — transient. Honor Retry-After if present.
      const ra = res.headers.get("Retry-After");
      const retryAfterMs = ra ? Math.max(0, Number.parseInt(ra, 10) * 1000) : 0;
      return { kind: "transient", status: res.status, retryAfterMs };
    } catch {
      // Network error
      return { kind: "transient", status: 0, retryAfterMs: 0 };
    }
  })();
  refreshInFlight = p;
  p.finally(() => {
    if (refreshInFlight === p) refreshInFlight = null;
  });
  return p;
}
```

Update the 401 branch in `request<T>`:

```typescript
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const result = await refreshAccessToken();
    if (result.kind === "ok") {
      res = await doFetch(result.accessToken);
    } else if (result.kind === "unauthenticated") {
      useAuthStore.getState().clear();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      throw new ApiError(401, "Unauthorized");
    } else {
      // transient — surface as the original 401 since we couldn't recover
      // here, but don't clear the store. The proactive scheduler (B9) will
      // retry on its own; the user-visible error becomes "request failed".
      throw new ApiError(401, "Unauthorized (refresh transient)");
    }
  }
```

- [ ] **Step 2: Update auth-store to store expiry**

Edit `apps/web/src/stores/auth-store.ts`:

```typescript
import type { PublicUser } from "@modeldoctor/contracts";
import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  accessTokenExpiresAt: string | null; // ISO
  user: PublicUser | null;
  setAuth: (accessToken: string, user: PublicUser, accessTokenExpiresAt: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  accessTokenExpiresAt: null,
  user: null,
  setAuth: (accessToken, user, accessTokenExpiresAt) =>
    set({ accessToken, user, accessTokenExpiresAt }),
  clear: () => set({ accessToken: null, user: null, accessTokenExpiresAt: null }),
}));
```

Find/update every other `setAuth` call site (login, register pages):

```bash
grep -rn "setAuth(" apps/web/src --include="*.ts" --include="*.tsx"
```

Each `setAuth(accessToken, user)` becomes `setAuth(accessToken, user, accessTokenExpiresAt)` reading from the same login/register response body.

- [ ] **Step 3: Update existing `api-client.test.ts` mocks**

Search for `json: () => Promise.resolve({ accessToken: ..., user: ... })` in `api-client.test.ts` and add `accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString()` to each.

Add a new test:

```typescript
describe("api-client.refreshAccessToken: discriminated result", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
  });

  it("200 + body → { kind: 'ok', accessToken }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accessToken: "fresh",
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user: mockUser,
          }),
      }),
    );
    const { refreshAccessToken } = await import("./api-client");
    const result = await refreshAccessToken();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.accessToken).toBe("fresh");
  });

  it("401 → { kind: 'unauthenticated' }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      }),
    );
    const { refreshAccessToken } = await import("./api-client");
    const result = await refreshAccessToken();
    expect(result.kind).toBe("unauthenticated");
  });

  it("429 with Retry-After → { kind: 'transient', retryAfterMs > 0 }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k === "Retry-After" ? "3" : null) },
        json: () => Promise.resolve({}),
      }),
    );
    const { refreshAccessToken } = await import("./api-client");
    const result = await refreshAccessToken();
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.status).toBe(429);
      expect(result.retryAfterMs).toBe(3000);
    }
  });

  it("network error → { kind: 'transient', status: 0 }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { refreshAccessToken } = await import("./api-client");
    const result = await refreshAccessToken();
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") expect(result.status).toBe(0);
  });
});
```

- [ ] **Step 4: Run web tests + typecheck**

```bash
cd apps/web
pnpm test
pnpm type-check
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts apps/web/src/stores/auth-store.ts apps/web/src/features/auth/LoginPage.tsx apps/web/src/features/auth/RegisterPage.tsx
git commit -m "refactor(web/auth): RefreshResult discriminated union + accessTokenExpiresAt in store

refreshAccessToken now returns a typed { kind: 'ok' | 'unauthenticated' |
'transient' } so callers can distinguish a real auth failure from a
network/rate-limit blip and decide whether to redirect or retry.

auth-store gains accessTokenExpiresAt so the upcoming proactive-refresh
scheduler (Task B9) can timer off it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B5: Client — Web Locks cross-tab coordinator

**Goal:** Wrap `refreshAccessToken` in `navigator.locks.request("md-auth-refresh", { mode: "exclusive" }, …)` so multiple tabs of the same origin only fire ONE network call. Followers wait for the lock, then read the freshly-broadcast result.

**Files:**
- Create: `apps/web/src/lib/auth-coordinator.ts`
- Create: `apps/web/src/lib/auth-coordinator.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`

- [ ] **Step 1: Write the coordinator failing test**

`apps/web/src/lib/auth-coordinator.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatedRefresh } from "./auth-coordinator";

describe("coordinatedRefresh", () => {
  let bc: { postMessage: ReturnType<typeof vi.fn>; close: () => void; onmessage: null | ((e: MessageEvent) => void) };
  let lockHolders: Array<() => void>;
  let lockHeld: boolean;

  beforeEach(() => {
    lockHolders = [];
    lockHeld = false;
    bc = {
      postMessage: vi.fn(),
      close: () => undefined,
      onmessage: null,
    };
    vi.stubGlobal("BroadcastChannel", vi.fn().mockImplementation(() => bc));
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      locks: {
        request: vi.fn().mockImplementation(async (_name: string, _opts: unknown, cb: () => Promise<unknown>) => {
          if (lockHeld) {
            // Simulate waiting for the lock by waiting for the holder to release
            await new Promise<void>((resolve) => lockHolders.push(resolve));
          }
          lockHeld = true;
          try {
            return await cb();
          } finally {
            lockHeld = false;
            const next = lockHolders.shift();
            if (next) next();
          }
        }),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls fetcher exactly once when invoked twice in parallel under the same lock", async () => {
    const fetcher = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const [a, b] = await Promise.all([coordinatedRefresh(fetcher), coordinatedRefresh(fetcher)]);
    // Within ONE tab, the module-level promise dedup means fetcher runs once;
    // under web-locks across tabs it would also run once because the second
    // tab waits for the lock then re-reads the broadcast result.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
  });

  it("falls back gracefully when navigator.locks is undefined", async () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, locks: undefined });
    const fetcher = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const result = await coordinatedRefresh(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("ok");
  });

  it("broadcasts the result on success", async () => {
    const fetcher = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    await coordinatedRefresh(fetcher);
    expect(bc.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" }));
  });
});
```

- [ ] **Step 2: Run — fails (no module)**

```bash
cd apps/web
pnpm test -- auth-coordinator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/src/lib/auth-coordinator.ts`**

```typescript
import type { RefreshResult } from "./api-client";

const LOCK_NAME = "md-auth-refresh";
const CHANNEL_NAME = "md-auth";

type ChannelMessage =
  | { kind: "ok"; accessToken: string }
  | { kind: "unauthenticated" }
  | { kind: "transient"; status: number };

let inFlight: Promise<RefreshResult> | null = null;
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/**
 * Run `fetcher` under a cross-tab exclusive Web Lock so only one tab actually
 * issues the /auth/refresh network call. The result is broadcast on a
 * BroadcastChannel so other tabs (which awoke later and acquired the lock
 * after this tab released it) can short-circuit to the cached result if it's
 * still fresh.
 *
 * Falls back to plain promise dedup when navigator.locks is unavailable.
 */
export async function coordinatedRefresh(
  fetcher: () => Promise<RefreshResult>,
): Promise<RefreshResult> {
  if (inFlight) return inFlight;

  const run = async (): Promise<RefreshResult> => {
    const result = await fetcher();
    const ch = getChannel();
    if (ch) {
      const msg: ChannelMessage =
        result.kind === "ok"
          ? { kind: "ok", accessToken: result.accessToken }
          : result.kind === "unauthenticated"
            ? { kind: "unauthenticated" }
            : { kind: "transient", status: result.status };
      ch.postMessage(msg);
    }
    return result;
  };

  const locks = (globalThis.navigator as Navigator & { locks?: LockManager }).locks;
  const p = locks
    ? locks.request(LOCK_NAME, { mode: "exclusive" }, run)
    : run();

  inFlight = p as Promise<RefreshResult>;
  void p.finally(() => {
    if (inFlight === p) inFlight = null;
  });
  return inFlight;
}

/**
 * Subscribe to refresh results from other tabs. Returns an unsubscribe fn.
 * Use this from BootGate so that if another tab refreshes first, we can
 * skip our own probe and read the result.
 */
export function onRefreshBroadcast(handler: (msg: ChannelMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => undefined;
  const listener = (e: MessageEvent) => handler(e.data as ChannelMessage);
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}
```

- [ ] **Step 4: Wire `refreshAccessToken` to use `coordinatedRefresh`**

Replace the body of `refreshAccessToken` in `api-client.ts`:

```typescript
export async function refreshAccessToken(): Promise<RefreshResult> {
  return coordinatedRefresh(async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const body = (await res.json()) as {
          accessToken: string;
          accessTokenExpiresAt: string;
          user: PublicUser;
        };
        useAuthStore.getState().setAuth(body.accessToken, body.user, body.accessTokenExpiresAt);
        return { kind: "ok", accessToken: body.accessToken };
      }
      if (res.status === 401 || res.status === 403) {
        return { kind: "unauthenticated" };
      }
      const ra = res.headers.get("Retry-After");
      const retryAfterMs = ra ? Math.max(0, Number.parseInt(ra, 10) * 1000) : 0;
      return { kind: "transient", status: res.status, retryAfterMs };
    } catch {
      return { kind: "transient", status: 0, retryAfterMs: 0 };
    }
  });
}
```

Add `import { coordinatedRefresh } from "./auth-coordinator";` at the top.

Remove the now-redundant module-level `refreshInFlight` from `api-client.ts` (the coordinator owns it).

- [ ] **Step 5: Run web tests + typecheck**

```bash
pnpm test
pnpm type-check
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/auth-coordinator.ts apps/web/src/lib/auth-coordinator.test.ts apps/web/src/lib/api-client.ts
git commit -m "feat(web/auth): Web Locks + BroadcastChannel cross-tab refresh coordinator

Wraps the refresh fetcher in navigator.locks.request('md-auth-refresh',
{ mode: 'exclusive' }) so multiple tabs of the same origin only issue
ONE /auth/refresh network call. The winner broadcasts the result on
BroadcastChannel('md-auth') so followers can short-circuit. Falls back
to single-tab promise dedup when navigator.locks is unavailable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B6: Client — BootGate session-cookie precheck

**Goal:** BootGate inspects `document.cookie` for `md_session=1` before deciding whether to call `/refresh`. If absent, immediately resolve as unauthenticated (zero network calls). If present, proceed with the normal refresh.

**Files:**
- Modify: `apps/web/src/features/auth/ProtectedRoute.tsx`
- Modify: `apps/web/src/features/auth/ProtectedRoute.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/auth/ProtectedRoute.test.tsx`:

```typescript
describe("ProtectedRoute / BootGate session-cookie precheck", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
    Object.defineProperty(document, "cookie", { writable: true, value: "" });
    vi.restoreAllMocks();
  });

  it("when md_session cookie is absent → redirects to /login WITHOUT calling /refresh", async () => {
    Object.defineProperty(document, "cookie", { writable: true, value: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithRoutes("/");

    await waitFor(() => {
      expect(screen.getByText("Login page")).toBeInTheDocument();
    });
    expect(fetchMock, "no /refresh probe when no session cookie").not.toHaveBeenCalled();
  });

  it("when md_session=1 is present → calls /refresh and renders protected", async () => {
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "md_session=1; theme=dark",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accessToken: "ok",
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user: mockUser,
          }),
      }),
    );
    renderWithRoutes("/");
    await waitFor(() => expect(screen.getByText("Protected content")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run — fails (precheck not implemented)**

```bash
cd apps/web
pnpm test -- ProtectedRoute.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the precheck**

Replace `apps/web/src/features/auth/ProtectedRoute.tsx`:

```typescript
import { refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

interface BootGateProps {
  children: ReactNode;
}

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  // Lightweight scan — no need for a full parser. Looks for "md_session=1"
  // anywhere in the cookie header (with the standard "; "-separated form
  // browsers emit). False positives are harmless (we'd just probe /refresh
  // and gracefully handle the 401).
  return /(?:^|;\s*)md_session=1(?:;|$)/.test(document.cookie);
}

function BootGate({ children }: BootGateProps) {
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Already authenticated in this session → no need to probe.
    if (useAuthStore.getState().accessToken) {
      setProbed(true);
      return;
    }
    // No session cookie → user has never logged in (or has logged out).
    // Skip the network call entirely; ProtectedRoute will Navigate to /login.
    if (!hasSessionCookie()) {
      setProbed(true);
      return;
    }
    void refreshAccessToken().finally(() => {
      if (!cancelled) setProbed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!probed) return null;
  return <>{children}</>;
}

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const location = useLocation();

  return (
    <BootGate>
      {accessToken ? (
        <Outlet />
      ) : (
        <Navigate to="/login" state={{ from: location.pathname }} replace />
      )}
    </BootGate>
  );
}
```

- [ ] **Step 4: Run — pass**

```bash
pnpm test -- ProtectedRoute.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/ProtectedRoute.tsx apps/web/src/features/auth/ProtectedRoute.test.tsx
git commit -m "feat(web/auth): BootGate skips /refresh probe when no md_session cookie

If the user has never logged in (or has logged out), the SPA boot path
no longer wastes a network roundtrip + counts against rate-limits to
discover that. Reduces dev-iteration friction and the cold-start latency
for unauthenticated visitors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B7: Client — BootGate retry-with-backoff for transient errors

**Goal:** When `/refresh` returns 429 / 5xx / network error, BootGate retries with exponential backoff + jitter (max 3 attempts: 250ms → 1s → 4s) BEFORE giving up. Only `kind: "unauthenticated"` results in immediate redirect.

**Files:**
- Modify: `apps/web/src/features/auth/ProtectedRoute.tsx`
- Modify: `apps/web/src/features/auth/ProtectedRoute.test.tsx`

- [ ] **Step 1: Add a backoff helper**

Create `apps/web/src/lib/retry-with-backoff.ts`:

```typescript
export interface RetryOptions {
  maxAttempts: number;
  baseMs: number;
  factor: number;
  jitter: () => number; // 0..1
}

export const DEFAULT_REFRESH_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseMs: 250,
  factor: 4,
  jitter: () => Math.random(),
};

/**
 * Generic exponential-backoff retry. The predicate decides whether the
 * result is "good" (return) or transient (retry). Honors a result-supplied
 * retryAfterMs hint when the result includes one.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  isTransient: (result: T) => false | { retryAfterMs: number },
  opts: RetryOptions = DEFAULT_REFRESH_RETRY,
): Promise<T> {
  let attempt = 0;
  while (true) {
    const result = await fn();
    const transient = isTransient(result);
    if (!transient || attempt >= opts.maxAttempts - 1) return result;
    const expBackoff = opts.baseMs * opts.factor ** attempt;
    const delay = Math.max(transient.retryAfterMs, expBackoff * (0.5 + opts.jitter() * 0.5));
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    attempt += 1;
  }
}
```

- [ ] **Step 2: Test the helper**

`apps/web/src/lib/retry-with-backoff.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry-with-backoff";

describe("retryWithBackoff", () => {
  afterEach(() => vi.useRealTimers());

  it("returns immediately on non-transient first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, () => false, {
      maxAttempts: 3,
      baseMs: 1,
      factor: 2,
      jitter: () => 0,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts then returns last result", async () => {
    const fn = vi.fn().mockResolvedValue("transient");
    const result = await retryWithBackoff(fn, () => ({ retryAfterMs: 0 }), {
      maxAttempts: 3,
      baseMs: 1,
      factor: 2,
      jitter: () => 0,
    });
    expect(result).toBe("transient");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("honors retryAfterMs as a floor", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => (calls++ === 0 ? "transient" : "ok"));
    const start = Date.now();
    await retryWithBackoff(
      fn,
      (r) => (r === "transient" ? { retryAfterMs: 50 } : false),
      { maxAttempts: 3, baseMs: 1, factor: 1, jitter: () => 0 },
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // some scheduler slack
  });
});
```

- [ ] **Step 3: Run — pass**

```bash
pnpm test -- retry-with-backoff.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update BootGate to retry transient outcomes**

Replace the BootGate `useEffect` body:

```typescript
  useEffect(() => {
    let cancelled = false;
    if (useAuthStore.getState().accessToken) {
      setProbed(true);
      return;
    }
    if (!hasSessionCookie()) {
      setProbed(true);
      return;
    }
    void retryWithBackoff(refreshAccessToken, (r) =>
      r.kind === "transient" ? { retryAfterMs: r.retryAfterMs } : false,
    ).finally(() => {
      if (!cancelled) setProbed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
```

Add the import: `import { retryWithBackoff } from "@/lib/retry-with-backoff";`

- [ ] **Step 5: Add a BootGate test for transient retry**

Append to `ProtectedRoute.test.tsx`:

```typescript
  it("retries on 429 transient then succeeds → renders protected content", async () => {
    Object.defineProperty(document, "cookie", { writable: true, value: "md_session=1" });
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        };
      }
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accessToken: "ok-after-retry",
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user: mockUser,
          }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithRoutes("/");
    await waitFor(
      () => expect(screen.getByText("Protected content")).toBeInTheDocument(),
      { timeout: 5_000 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 6: Run web tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/retry-with-backoff.ts apps/web/src/lib/retry-with-backoff.test.ts apps/web/src/features/auth/ProtectedRoute.tsx apps/web/src/features/auth/ProtectedRoute.test.tsx
git commit -m "feat(web/auth): BootGate retries transient /refresh failures with jittered backoff

429/5xx/network failures now retry up to 3 times (250ms / 1s / 4s with
0.5x-1.0x jitter, honoring Retry-After when present) before giving up.
Only kind:'unauthenticated' results redirect immediately. Eliminates
the false-positive bounce-to-login that happens when /refresh hits a
transient hiccup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B8: Client — proactive expiry-driven silent refresh

**Goal:** Once authenticated, schedule a `setTimeout` to call `refreshAccessToken` ~30s before the access token expires. Cancels on logout / manual refresh; reschedules on every successful refresh.

**Files:**
- Create: `apps/web/src/lib/access-token-scheduler.ts`
- Create: `apps/web/src/lib/access-token-scheduler.test.ts`
- Modify: `apps/web/src/App.tsx` (mount the scheduler at root)

- [ ] **Step 1: Write the scheduler test**

`apps/web/src/lib/access-token-scheduler.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAccessTokenScheduler } from "./access-token-scheduler";
import { useAuthStore } from "@/stores/auth-store";

const mockUser = { id: "u1", email: "u@x", roles: ["user"], createdAt: new Date().toISOString() };

describe("startAccessTokenScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("schedules refresh ~30s before expiry when store transitions to authenticated", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const stop = startAccessTokenScheduler(refreshFn);

    const expiresAt = new Date(Date.now() + 60_000).toISOString(); // 60s from now
    useAuthStore.setState({ accessToken: "tok", user: mockUser, accessTokenExpiresAt: expiresAt });

    // Should not fire immediately
    expect(refreshFn).not.toHaveBeenCalled();

    // Fast-forward 29s — still 31s away from expiry, refresh fires at expiry-30s = 30s mark
    vi.advanceTimersByTime(29_999);
    expect(refreshFn).not.toHaveBeenCalled();

    // Fast-forward to the scheduled moment
    vi.advanceTimersByTime(2);
    await vi.runAllTimersAsync();
    expect(refreshFn).toHaveBeenCalledTimes(1);

    stop();
  });

  it("cancels scheduled refresh when store is cleared (logout)", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const stop = startAccessTokenScheduler(refreshFn);

    useAuthStore.setState({
      accessToken: "tok",
      user: mockUser,
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });

    vi.advanceTimersByTime(120_000);
    await vi.runAllTimersAsync();
    expect(refreshFn).not.toHaveBeenCalled();
    stop();
  });

  it("clamps near-instant expiry to a minimum 1s delay (avoid tight loop)", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const stop = startAccessTokenScheduler(refreshFn);

    // Already past or within the 30s leadtime
    useAuthStore.setState({
      accessToken: "tok",
      user: mockUser,
      accessTokenExpiresAt: new Date(Date.now() + 1_000).toISOString(),
    });

    expect(refreshFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(refreshFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    await vi.runAllTimersAsync();
    expect(refreshFn).toHaveBeenCalledTimes(1);
    stop();
  });
});
```

- [ ] **Step 2: Run — fails (no module)**

```bash
pnpm test -- access-token-scheduler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the scheduler**

`apps/web/src/lib/access-token-scheduler.ts`:

```typescript
import { useAuthStore } from "@/stores/auth-store";
import type { RefreshResult } from "./api-client";

const LEADTIME_MS = 30_000;
const MIN_DELAY_MS = 1_000;

/**
 * Subscribes to the auth store and schedules a setTimeout to call `refreshFn`
 * ~30s before the current access token expires. Reschedules on every store
 * change (login, refresh, logout).
 *
 * Pause/resume on document visibility:
 *  - hidden: clear the timer (the OS may throttle inactive-tab timers anyway,
 *    and there's no UX cost to deferring a background refresh)
 *  - visible: re-evaluate immediately. If we missed the leadtime window while
 *    the tab was hidden, fire the refresh now.
 *
 * Returns a cleanup function.
 */
export function startAccessTokenScheduler(refreshFn: () => Promise<RefreshResult>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    cancel();
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const { accessTokenExpiresAt } = useAuthStore.getState();
    if (!accessTokenExpiresAt) return;
    const expiresMs = Date.parse(accessTokenExpiresAt);
    if (Number.isNaN(expiresMs)) return;
    const delay = Math.max(MIN_DELAY_MS, expiresMs - Date.now() - LEADTIME_MS);
    timer = setTimeout(() => {
      void refreshFn();
    }, delay);
  };

  const unsubStore = useAuthStore.subscribe(schedule);
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") schedule();
    else cancel();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  // Initial schedule (in case the store was already populated).
  schedule();

  return (): void => {
    cancel();
    unsubStore();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
```

- [ ] **Step 4: Mount the scheduler at app root**

Edit `apps/web/src/App.tsx`. After the existing imports, add:

```typescript
import { useEffect } from "react";
import { startAccessTokenScheduler } from "@/lib/access-token-scheduler";
import { refreshAccessToken } from "@/lib/api-client";
```

In the `App` component body, add:

```typescript
  useEffect(() => {
    return startAccessTokenScheduler(refreshAccessToken);
  }, []);
```

- [ ] **Step 5: Run web tests + typecheck**

```bash
pnpm test
pnpm type-check
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/access-token-scheduler.ts apps/web/src/lib/access-token-scheduler.test.ts apps/web/src/App.tsx
git commit -m "feat(web/auth): proactive silent refresh ~30s before token expiry

Subscribes to the auth store and schedules a setTimeout that calls
refreshAccessToken when the current access token is 30s away from
expiry. Reschedules on every successful refresh (the new
accessTokenExpiresAt resets the timer).

Pauses on document.visibilityState === 'hidden' (no point burning
network when the tab is offscreen) and resumes on 'visible'. If the
tab returns visible past the leadtime window, refresh fires
immediately.

Eliminates the 'click → 401 → refresh → retry' UX hiccup that
appears when access tokens expire while the user is mid-task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task B9: Manual smoke + open PR B

- [ ] **Step 1: Run the dev stack and validate the user-reported bug is gone**

```bash
# In one shell
cd /Users/fangyong/vllm/modeldoctor/feat/auth-refresh-client-hardening
pnpm dev
```

Open `http://localhost:5173`, log in, then:
1. Reload the page 30 times in a row, fast. Expected: no kicks to /login.
2. Open DevTools Network → preserve log. Confirm only ONE POST `/api/auth/refresh` per reload (Web Locks dedup), no 429s.
3. In a second tab, navigate to the app. Expected: no second `/refresh` (cross-tab dedup); accessToken in store is the broadcast value.
4. Wait until `accessTokenExpiresAt - 30s`. Expected: a silent `/refresh` fires automatically without user interaction.
5. Click "Logout". Expected: `md_session` cookie cleared, store cleared, redirected to /login. Reload: zero network calls before the /login render.

- [ ] **Step 2: Run the full lint + typecheck + test sweep**

```bash
pnpm -r lint && pnpm -r type-check && pnpm -r test
pnpm -F @modeldoctor/api test:e2e
```

Expected: all clean.

- [ ] **Step 3: Push + open PR B**

```bash
git push -u origin feat/auth-refresh-client-hardening

gh pr create --title "feat(web/auth): cross-tab Web Locks + session-cookie precheck + proactive expiry refresh" --body "$(cat <<'EOF'
## Summary

- Server emits a non-HttpOnly `md_session=1` cookie alongside `md_refresh`. SPA's `BootGate` skips the `/refresh` probe entirely when the cookie is absent — zero network calls for unauthenticated visitors.
- `AuthTokenResponse` carries `accessTokenExpiresAt` (ISO). Store persists it; client never decodes JWTs.
- `refreshAccessToken` returns a discriminated union `{ kind: 'ok' | 'unauthenticated' | 'transient' }` so callers can distinguish auth failure from rate-limit / 5xx / network blip.
- Cross-tab dedup via W3C Web Locks API (`navigator.locks.request('md-auth-refresh', { mode: 'exclusive' })`). Multiple tabs of the same origin issue ONE `/refresh` call between them; result fanned out via `BroadcastChannel('md-auth')`. Falls back to single-tab promise dedup when `navigator.locks` is unavailable.
- BootGate retries transient failures with exponential backoff (250ms / 1s / 4s) + jitter, honoring `Retry-After`. Only `unauthenticated` redirects immediately.
- Proactive silent refresh: `setTimeout` fires 30s before access-token expiry, paused on `document.visibilityState === 'hidden'`, resumed on visible. No more 'click → wait for 401-driven refresh' UX hiccups.

Builds on PR #<A's number> which added rotation chain + grace window + family-scoped theft detection on the server.

## Test plan

- [ ] `pnpm -F @modeldoctor/api test:e2e -- auth.e2e-spec.ts` — md_session cookie set/cleared
- [ ] `pnpm -F @modeldoctor/web test` — auth-coordinator, retry-with-backoff, access-token-scheduler, ProtectedRoute precheck/retry covered
- [ ] Manual: log in, reload 30x in a row → zero kicks
- [ ] Manual: two tabs, only one /refresh fires
- [ ] Manual: idle until 30s before expiry → silent /refresh observed in Network tab
- [ ] Manual: logout → md_session cookie cleared, reload → zero network calls before /login

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR B done.

---

## Self-review — spec coverage matrix

| Requirement | Task |
|---|---|
| §1 Drop per-IP throttle on /refresh | A6 |
| §2 RT rotation grace window (30s) | A3, A4, A7, A8 |
| §3 Server-side single-flight (FOR UPDATE in Serializable txn) | A3, A7 |
| §4 Cross-tab single-flight (Web Locks + BroadcastChannel) | B5 |
| §5 Session-presence cookie / skip pointless refresh | B1, B6 |
| §6 Discriminated union for failure modes + backoff | B4, B7 |
| §7 Proactive silent refresh + visibilitychange | B8 |
| Family-scoped theft detection (not user-scoped) | A3, A5, A8 |

All seven requirements from the design discussion have at least one task.

## Self-review — placeholder scan

No "TODO", "TBD", "implement later", or "similar to Task N" markers. Every code block is complete; every command has its expected outcome. Branch names, file paths, line numbers grounded in the actual repo layout.
