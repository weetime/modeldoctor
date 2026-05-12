# User Center + Global AI Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a User Center page (`/me`) for profile/password/notifications, and migrate `LlmJudgeProvider` from per-user to a global singleton so AI Diagnostics is a true system-level setting.

**Architecture:**
- **`/me` (new)** for identity: displayName/avatar/email view, change password. Compact, form-shaped.
- **`/me/notifications` (new)** for the per-user channel table (moved verbatim from `/settings/notifications`). Owns its own PageHeader + "New channel" rightSlot.
- **`/settings` (kept)** owns workspace/global things: Appearance, AI Diagnostics (now global), Environment, Danger zone. The `NotificationsSettingsSection` summary card is **removed** from `/settings`.
- **`/settings/notifications` → redirect** to `/me/notifications` for back-compat.
- **`LlmJudgeProvider`**: drop `userId` (and FK + unique index). Service reads via `findFirst({orderBy: updatedAt desc})` so any stale rows that survived the migration are simply ignored. Migration is schema-only per CLAUDE.md; we **do not** delete rows in the migration. All authenticated users read/write the global config; role-gating is out of scope for this PR.

**Starting-state note:** Plan assumes `main` at or after commit `7bab74b` (notifications IA refactor #171). At that commit, channels live in `apps/web/src/features/settings/NotificationsPage.tsx` (exported as `SettingsNotificationsPage`, mounted at `/settings/notifications`) and subscriptions are managed inside `apps/web/src/features/notifications/ChannelSheet.tsx`. There is **no** longer a top-level `NotificationsPage.tsx` under `features/notifications/`. The plan effectively reverts the #171 placement (re-personalizing the IA) while keeping the consolidated channel/subscription editing UX (ChannelSheet).

**Tech Stack:** Prisma + Postgres, NestJS, React + react-router, react-query, react-hook-form + zod, shadcn/ui Form primitives, i18next.

**Branch / Worktree:** `feat/user-center-and-global-ai-judge` cut from `main`, in a fresh worktree at `/Users/fangyong/vllm/modeldoctor/feat-user-center`.

**PR shape:** Single PR with phase-per-commit (per CLAUDE.md "structurally-coupled work").

---

## File Structure

### Created
- `apps/web/src/features/me/MePage.tsx` — `/me` identity page (Profile + Password sections).
- `apps/web/src/features/me/ProfileSection.tsx` — displayName + avatar (data-URL upload) + email view.
- `apps/web/src/features/me/PasswordSection.tsx` — current/new/confirm password form.
- `apps/web/src/features/me/MeNotificationsPage.tsx` — channel table at `/me/notifications` (port of the existing `SettingsNotificationsPage`; breadcrumbs re-rooted on `/me`).
- `apps/web/src/features/me/queries.ts` — react-query hooks: `useUpdateProfile`, `useChangePassword`.
- `apps/web/src/features/me/AvatarUpload.tsx` — `<Avatar>` + file input → data URL → PATCH.
- `apps/web/src/features/me/MePage.test.tsx` — smoke render.
- `apps/web/src/features/me/PasswordSection.test.tsx` — validation + happy path.
- `apps/web/src/locales/en-US/me.json`, `apps/web/src/locales/zh-CN/me.json` — new namespace.
- `apps/api/src/modules/users/users.controller.ts` — new `GET/PATCH /api/me`, `POST /api/me/password`.
- `apps/api/src/modules/users/users.module.ts` — wire controller + service.
- `apps/api/test/e2e/me.e2e-spec.ts` — e2e for the three new endpoints.

### Modified
- `apps/api/prisma/schema.prisma` — User += `displayName`/`avatarUrl`; LlmJudgeProvider -= `userId`/relation.
- `apps/api/prisma/migrations/<timestamp>_user_profile_and_global_llm_judge/migration.sql` — schema-only (no data DML).
- `packages/contracts/src/auth.ts` — PublicUser += displayName/avatarUrl; add UpdateProfile + ChangePassword schemas.
- `apps/api/src/modules/users/users.service.ts` — `updateProfile`, `changePassword`, extended `toPublic`.
- `apps/api/src/modules/auth/auth.controller.ts` — keep `GET /api/auth/me` for token-issuance flows; tests still reference it. (No deletion — the new `/api/me` is additive.)
- `apps/api/src/modules/auth/auth.module.ts` — drop the `UsersService` provider entry; import `UsersModule` instead.
- `apps/api/src/app.module.ts` — register `UsersModule`.
- `apps/api/src/modules/llm-judge/llm-judge.service.ts` — drop `userId`; `findFirst({orderBy: updatedAt desc})` + targeted update/create.
- `apps/api/src/modules/llm-judge/llm-judge.controller.ts` — drop `@CurrentUser` plumbing; keep `JwtAuthGuard`.
- `apps/api/src/modules/llm-judge/llm-judge.service.spec.ts` — rewrite for global API.
- `apps/api/test/e2e/llm-judge.e2e-spec.ts` — rewrite: config visible across users.
- `apps/api/src/modules/insights/synthesize.service.ts:90` — `judge.getDecrypted()` no-arg.
- `apps/web/src/features/settings/SettingsPage.tsx` — remove `<NotificationsSettingsSection />` (line 106) and its import (line 31).
- `apps/web/src/router/index.tsx` — add `/me` and `/me/notifications` routes; change `/settings/notifications` to a redirect to `/me/notifications`.
- `apps/web/src/components/sidebar/Sidebar.tsx` — replace email/logout panel with avatar + name + dropdown menu (Profile / Logout).
- `apps/web/src/lib/i18n.ts` — register `me` namespace.
- `apps/web/src/locales/{en-US,zh-CN}/settings.json` — AI section copy: emphasize "global". Keep `notifications.section.*` keys (the settings-side summary card is removed; sub-page breadcrumbs are re-targeted but keys can be reused by `me.json` if desired — see Task 11).
- `apps/web/src/locales/{en-US,zh-CN}/sidebar.json` — add `items.profile`, `items.logout` if not present.
- `apps/web/src/stores/auth-store.ts` — add `setUser` action; PublicUser shape extension is backwards-compatible.
- `apps/web/src/lib/api.ts` — add `patch()` helper if not already present.

### Deleted
- `apps/web/src/features/settings/NotificationsPage.tsx` — replaced by `apps/web/src/features/me/MeNotificationsPage.tsx`.
- `apps/web/src/features/settings/NotificationsSettingsSection.tsx` — settings-side summary card no longer needed.

---

## Phase 1 — Worktree, schema, migration

### Task 1: Create feature worktree from main

**Files:**
- N/A (filesystem op)

- [ ] **Step 1: Fetch + fast-forward local main**

The bare+worktree layout has the local `main` branch checked out in `main/`. Bring it up to date with `origin/main` before branching, so the feature worktree starts at the latest commit (avoids an immediate rebase later):

```bash
git -C /Users/fangyong/vllm/modeldoctor/main fetch origin
git -C /Users/fangyong/vllm/modeldoctor/main status --short
git -C /Users/fangyong/vllm/modeldoctor/main pull --ff-only origin main
git -C /Users/fangyong/vllm/modeldoctor/main log --oneline -1
```
Expected: status empty; pull either reports "Already up to date." or fast-forwards; HEAD matches `origin/main`. If `pull --ff-only` fails because `main` has diverged, **stop and report to the user** — do not force-update.

- [ ] **Step 2: Create worktree on a new branch from the updated main**

```bash
git -C /Users/fangyong/vllm/modeldoctor/main worktree add \
  /Users/fangyong/vllm/modeldoctor/feat-user-center \
  -b feat/user-center-and-global-ai-judge main
```
Expected: `feat-user-center/` populated; HEAD on the new branch at the same commit as `main`.

- [ ] **Step 3: Initial workspace build (per worktree-build-first rule)**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm install --frozen-lockfile
pnpm -r build
```
Expected: `packages/contracts/dist/*` populated; api/web compile.

- [ ] **Step 4: Copy this plan into the feature worktree**

```bash
cp /Users/fangyong/vllm/modeldoctor/main/docs/superpowers/plans/2026-05-12-user-center-and-global-ai-judge.md \
   /Users/fangyong/vllm/modeldoctor/feat-user-center/docs/superpowers/plans/
```

- [ ] **Step 5: Commit the plan**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
git add docs/superpowers/plans/2026-05-12-user-center-and-global-ai-judge.md
git commit -m "$(cat <<'EOF'
docs: plan user center + global AI judge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Update Prisma schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (User model lines 11–32, LlmJudgeProvider lines 245–260)

- [ ] **Step 1: Add User profile fields**

In `apps/api/prisma/schema.prisma`, edit the `User` model. Replace:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  roles        String[] @default([])
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
```

with:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  roles        String[] @default([])
  displayName  String?  @map("display_name")
  avatarUrl    String?  @map("avatar_url") @db.Text
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
```

(`@db.Text` because avatar may be a base64 data URL up to ~200KB.)

- [ ] **Step 2: Drop userId from LlmJudgeProvider**

Replace the existing model:

```prisma
model LlmJudgeProvider {
  id           String  @id @default(cuid())
  userId       String  @unique @map("user_id")
  baseUrl      String  @map("base_url")
  apiKeyCipher String  @map("api_key_cipher")
  model        String
  enabled      Boolean @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("llm_judge_providers")
}
```

with:

```prisma
model LlmJudgeProvider {
  id           String  @id @default(cuid())
  baseUrl      String  @map("base_url")
  apiKeyCipher String  @map("api_key_cipher")
  model        String
  enabled      Boolean @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("llm_judge_providers")
}
```

- [ ] **Step 3: Remove the reverse relation from User**

In the same file, in the `User` model relations list, remove the line:
```prisma
  llmJudgeProvider     LlmJudgeProvider?
```

- [ ] **Step 4: Sanity check the diff**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
git diff apps/api/prisma/schema.prisma
```
Expected: three additions to User, deletions to LlmJudgeProvider (userId/index/FK/back-relation).

---

### Task 3: Generate migration with --create-only and add data preservation

**Files:**
- Create (via Prisma): `apps/api/prisma/migrations/<timestamp>_user_profile_and_global_llm_judge/migration.sql`

- [ ] **Step 1: Surface DB drift risk to the user**

Per memory rule "Always ask before resetting ModelDoctor dev DB": before running migrate, post a chat message to the user noting:
- Migration drops `llm_judge_providers.user_id` and keeps the most-recently-updated row as the new global config.
- Other rows (if any) will be deleted as part of the migration.
- If `prisma migrate dev` detects drift and proposes a reset, **stop and ask** before proceeding.

- [ ] **Step 2: Generate the migration scaffold**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/api
pnpm dlx prisma migrate dev --create-only --name user_profile_and_global_llm_judge
```
Expected: a new `apps/api/prisma/migrations/<TS>_user_profile_and_global_llm_judge/migration.sql` file. No DB changes yet.

If drift is reported, stop and notify the user.

- [ ] **Step 3: Inspect the generated migration**

Open the generated `migration.sql`. Confirm Prisma emitted only schema changes — something like:
```sql
ALTER TABLE "llm_judge_providers" DROP CONSTRAINT "llm_judge_providers_user_id_fkey";
DROP INDEX "llm_judge_providers_user_id_key";
ALTER TABLE "llm_judge_providers" DROP COLUMN "user_id";

ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "display_name" TEXT;
```

**Do NOT add any `INSERT`/`UPDATE`/`DELETE` of business data** (per CLAUDE.md "Migrations are schema-only"). The new `displayName`/`avatarUrl` columns are nullable, so no backfill is required. Stale `llm_judge_providers` rows (if any) are tolerated by the service-layer `findFirst({orderBy: updatedAt desc})` — the latest row wins; older ones are inert.

- [ ] **Step 4: Apply the migration**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/api
pnpm dlx prisma migrate dev
```
Expected: migration applied; client regenerated; no drift.

- [ ] **Step 5: Commit schema + migration**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "$(cat <<'EOF'
feat(api): user profile fields + drop per-user LlmJudgeProvider

User: + displayName, avatarUrl (@db.Text for base64 data URLs).
LlmJudgeProvider: drop user_id (FK + unique index). Service-side
findFirst(orderBy updatedAt desc) means leftover rows are inert; we
do not delete data in the migration (schema-only per CLAUDE.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Backend: contracts + user endpoints

### Task 4: Extend contracts — PublicUser + UpdateProfile + ChangePassword

**Files:**
- Modify: `packages/contracts/src/auth.ts`

- [ ] **Step 1: Extend PublicUserSchema**

Replace the existing `PublicUserSchema` block with:

```typescript
export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  roles: z.array(z.string()),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(), // ISO
});
export type PublicUser = z.infer<typeof PublicUserSchema>;
```

- [ ] **Step 2: Add UpdateProfile + ChangePassword schemas**

Append to `packages/contracts/src/auth.ts`:

```typescript
// Profile updates. Both fields optional — server only mutates what's sent.
// avatarUrl accepts either an external URL or a base64 data URL (PNG/JPEG/WebP).
// Cap data URLs at 256KB total string length to bound the row size.
export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(60).nullable().optional(),
  avatarUrl: z
    .string()
    .max(256 * 1024)
    .nullable()
    .optional()
    .refine(
      (v) =>
        v == null ||
        v === "" ||
        v.startsWith("data:image/") ||
        /^https?:\/\//.test(v),
      { message: "avatarUrl must be a data:image/* URL or http(s) URL" },
    ),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
```

- [ ] **Step 3: Re-export from contracts barrel**

Open `packages/contracts/src/index.ts`. Confirm `auth.ts` is wildcard-exported (`export * from "./auth"`). If not, add it. (Likely already there.)

- [ ] **Step 4: Build contracts**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/contracts build
```
Expected: green; new types exported in `packages/contracts/dist/auth.d.ts`.

---

### Task 5: UsersService — updateProfile + changePassword + extended toPublic

**Files:**
- Modify: `apps/api/src/modules/users/users.service.ts`

- [ ] **Step 1: Replace toPublic to include new fields**

Replace the `toPublic` method:

```typescript
toPublic(u: {
  id: string;
  email: string;
  roles: string[];
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}): PublicUser {
  return {
    id: u.id,
    email: u.email,
    roles: u.roles,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
  };
}
```

- [ ] **Step 2: Add updateProfile**

Append to the class:

```typescript
async updateProfile(
  id: string,
  patch: { displayName?: string | null; avatarUrl?: string | null },
): Promise<PublicUser> {
  const data: { displayName?: string | null; avatarUrl?: string | null } = {};
  if (Object.hasOwn(patch, "displayName")) data.displayName = patch.displayName ?? null;
  if (Object.hasOwn(patch, "avatarUrl")) {
    // Treat empty string as "clear".
    data.avatarUrl = patch.avatarUrl ? patch.avatarUrl : null;
  }
  const u = await this.prisma.user.update({ where: { id }, data });
  return this.toPublic(u);
}
```

- [ ] **Step 3: Add changePassword**

Append:

```typescript
async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
  const u = await this.findById(id);
  const ok = await argon2.verify(u.passwordHash, currentPassword);
  if (!ok) throw new UnauthorizedException("Current password is incorrect");
  if (newPassword === currentPassword) {
    throw new BadRequestException("New password must differ from the current one");
  }
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  // Note: refresh tokens are intentionally NOT revoked here — out of scope for V1.
  // If we tighten this later, call this.prisma.refreshToken.updateMany(...).
}
```

Update the import block at the top of the file:

```typescript
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/api type-check
```
Expected: green.

---

### Task 6: Create UsersController for /api/me

**Files:**
- Create: `apps/api/src/modules/users/users.controller.ts`
- Create: `apps/api/src/modules/users/users.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/auth/auth.module.ts` (verify UsersService is provided/exported)

- [ ] **Step 1: Inspect existing module wiring**

```bash
grep -n "UsersService\|users.service" /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/api/src/modules/auth/auth.module.ts
```
Note where `UsersService` is registered. It's likely already a provider on `AuthModule`. We need a dedicated `UsersModule` so the new controller can inject it cleanly.

- [ ] **Step 2: Create UsersModule**

Write `apps/api/src/modules/users/users.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 3: Update AuthModule**

Open `apps/api/src/modules/auth/auth.module.ts`. If `UsersService` is currently a provider here, remove it from `providers` and instead import `UsersModule`. Adjust `imports`:

```typescript
imports: [
  // ...existing imports
  UsersModule,
],
```

Drop the `UsersService` provider entry (it now comes from `UsersModule`). Keep `AuthService` and the JWT strategy/guard.

- [ ] **Step 4: Create UsersController**

Write `apps/api/src/modules/users/users.controller.ts`:

```typescript
import {
  type ChangePasswordRequest,
  ChangePasswordRequestSchema,
  type PublicUser,
  type UpdateProfileRequest,
  UpdateProfileRequestSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { UsersService } from "./users.service.js";

@UseGuards(JwtAuthGuard)
@Controller("me")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: JwtPayload): Promise<PublicUser> {
    const u = await this.users.findById(user.sub);
    return this.users.toPublic(u);
  }

  @Patch()
  async patch(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<PublicUser> {
    return this.users.updateProfile(user.sub, body);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password")
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.users.changePassword(user.sub, body.currentPassword, body.newPassword);
  }
}
```

- [ ] **Step 5: Register UsersModule in AppModule**

Open `apps/api/src/app.module.ts`. Add to imports:

```typescript
import { UsersModule } from "./modules/users/users.module.js";
// ...
imports: [
  // ...existing
  UsersModule,
],
```

- [ ] **Step 6: Build api**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/api build
```
Expected: green.

---

### Task 7: e2e tests for /api/me

**Files:**
- Create: `apps/api/test/e2e/me.e2e-spec.ts`

- [ ] **Step 1: Inspect existing auth e2e helpers**

```bash
sed -n '1,80p' /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/api/test/e2e/auth.e2e-spec.ts
```
Note the `bootstrap`/`register`/login helpers — reuse the same pattern.

- [ ] **Step 2: Write the e2e spec**

Write `apps/api/test/e2e/me.e2e-spec.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "../../src/app.module.js";

describe("/api/me (e2e)", () => {
  let app: INestApplication;
  let accessToken: string;
  const email = `me-${Date.now()}@test.local`;
  const password = "test12345";

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix("api");
    app.use(cookieParser());
    await app.init();
    const r = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email, password });
    accessToken = r.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/me returns the current user with displayName/avatarUrl=null", async () => {
    const r = await request(app.getHttpServer())
      .get("/api/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(r.body.email).toBe(email);
    expect(r.body.displayName).toBeNull();
    expect(r.body.avatarUrl).toBeNull();
  });

  it("PATCH /api/me updates displayName", async () => {
    const r = await request(app.getHttpServer())
      .patch("/api/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ displayName: "Alice" })
      .expect(200);
    expect(r.body.displayName).toBe("Alice");
  });

  it("PATCH /api/me rejects invalid avatarUrl", async () => {
    await request(app.getHttpServer())
      .patch("/api/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ avatarUrl: "javascript:alert(1)" })
      .expect(400);
  });

  it("PATCH /api/me accepts a small data: URL", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const r = await request(app.getHttpServer())
      .patch("/api/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ avatarUrl: dataUrl })
      .expect(200);
    expect(r.body.avatarUrl).toBe(dataUrl);
  });

  it("POST /api/me/password rejects wrong current", async () => {
    await request(app.getHttpServer())
      .post("/api/me/password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: "wrong-pass", newPassword: "newpass123" })
      .expect(401);
  });

  it("POST /api/me/password changes the password and lets the new one log in", async () => {
    await request(app.getHttpServer())
      .post("/api/me/password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword: "newpass123" })
      .expect(204);

    const r = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "newpass123" })
      .expect(201);
    expect(r.body.user.email).toBe(email);
  });
});
```

- [ ] **Step 3: Run the e2e**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm test:e2e:api -- me.e2e-spec.ts
```
Expected: all 6 tests pass.

- [ ] **Step 4: Commit Phase 2**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
git add packages/contracts/src/auth.ts \
        apps/api/src/modules/users \
        apps/api/src/modules/auth/auth.module.ts \
        apps/api/src/app.module.ts \
        apps/api/test/e2e/me.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/me endpoints + extended PublicUser

GET/PATCH /api/me, POST /api/me/password. Adds displayName/avatarUrl
to PublicUser. UsersController lives in a new UsersModule so it can
inject UsersService without going through AuthModule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Backend: LlmJudge → global

### Task 8: Rewrite LlmJudgeService for global singleton

**Files:**
- Modify: `apps/api/src/modules/llm-judge/llm-judge.service.ts`

- [ ] **Step 1: Replace the file contents**

Full rewrite — write this exact content:

```typescript
// apps/api/src/modules/llm-judge/llm-judge.service.ts
import type { LlmJudgeProviderPublic, UpsertLlmJudgeProvider } from "@modeldoctor/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";

export interface DecryptedLlmJudgeProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

/**
 * Global (singleton) LLM-judge provider configuration. The table allows multiple
 * rows but we only ever read the most-recently-updated one; writes upsert by
 * matching that row's id (or create when the table is empty).
 */
@Injectable()
export class LlmJudgeService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    this.key = decodeKey(k);
  }

  private async findCurrent() {
    return this.prisma.llmJudgeProvider.findFirst({
      orderBy: { updatedAt: "desc" },
    });
  }

  async getPublic(): Promise<LlmJudgeProviderPublic | null> {
    const row = await this.findCurrent();
    if (!row) return null;
    return {
      id: row.id,
      baseUrl: row.baseUrl,
      model: row.model,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getDecrypted(): Promise<DecryptedLlmJudgeProvider | null> {
    const row = await this.findCurrent();
    if (!row) return null;
    return {
      id: row.id,
      baseUrl: row.baseUrl,
      apiKey: decrypt(row.apiKeyCipher, this.key),
      model: row.model,
      enabled: row.enabled,
    };
  }

  async upsert(input: UpsertLlmJudgeProvider): Promise<LlmJudgeProviderPublic> {
    const existing = await this.findCurrent();
    let apiKeyCipher: string;
    if (input.apiKey) {
      apiKeyCipher = encrypt(input.apiKey, this.key);
    } else if (existing) {
      apiKeyCipher = existing.apiKeyCipher;
    } else {
      throw new BadRequestException("apiKey is required to create the provider");
    }
    const row = existing
      ? await this.prisma.llmJudgeProvider.update({
          where: { id: existing.id },
          data: {
            baseUrl: input.baseUrl,
            apiKeyCipher,
            model: input.model,
            enabled: input.enabled,
          },
        })
      : await this.prisma.llmJudgeProvider.create({
          data: {
            baseUrl: input.baseUrl,
            apiKeyCipher,
            model: input.model,
            enabled: input.enabled,
          },
        });
    return {
      id: row.id,
      baseUrl: row.baseUrl,
      model: row.model,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async delete(): Promise<void> {
    const r = await this.prisma.llmJudgeProvider.deleteMany({});
    if (r.count === 0) throw new NotFoundException("No provider configured");
  }
}
```

- [ ] **Step 2: Update the controller**

Open `apps/api/src/modules/llm-judge/llm-judge.controller.ts`. Replace its contents:

```typescript
// apps/api/src/modules/llm-judge/llm-judge.controller.ts
import {
  type TestLlmJudgeRequest,
  type TestLlmJudgeResponse,
  type UpsertLlmJudgeProvider,
  llmJudgeProviderPublicSchema,
  testLlmJudgeRequestSchema,
  testLlmJudgeResponseSchema,
  upsertLlmJudgeProviderSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "./llm-judge.service.js";

@UseGuards(JwtAuthGuard)
@Controller("llm-judge")
export class LlmJudgeController {
  constructor(private readonly svc: LlmJudgeService) {}

  @Get("provider")
  async get() {
    const p = await this.svc.getPublic();
    return p ? llmJudgeProviderPublicSchema.parse(p) : null;
  }

  @Put("provider")
  async put(
    @Body(new ZodValidationPipe(upsertLlmJudgeProviderSchema)) body: UpsertLlmJudgeProvider,
  ) {
    return this.svc.upsert(body);
  }

  @Delete("provider")
  @HttpCode(204)
  async del() {
    await this.svc.delete();
  }

  @Post("test")
  async test(
    @Body(new ZodValidationPipe(testLlmJudgeRequestSchema)) body: TestLlmJudgeRequest,
  ): Promise<TestLlmJudgeResponse> {
    let apiKey = body.apiKey;
    if (!apiKey) {
      const saved = await this.svc.getDecrypted();
      if (!saved) {
        return testLlmJudgeResponseSchema.parse({
          ok: false,
          latencyMs: null,
          error: "No saved provider; supply apiKey to test",
        });
      }
      apiKey = saved.apiKey;
    }
    try {
      const r = await chatCompletion(
        { baseUrl: body.baseUrl, apiKey, model: body.model },
        [{ role: "user", content: "ping" }],
        { timeoutMs: 10_000 },
      );
      return testLlmJudgeResponseSchema.parse({ ok: true, latencyMs: r.latencyMs, error: null });
    } catch (e: any) {
      return testLlmJudgeResponseSchema.parse({
        ok: false,
        latencyMs: null,
        error: String(e?.message ?? e).slice(0, 500),
      });
    }
  }
}
```

- [ ] **Step 3: Update synthesize.service.ts call site**

Open `apps/api/src/modules/insights/synthesize.service.ts`. Find line 90 (`const provider = await this.judge.getDecrypted(userId);`) and change to:

```typescript
    const provider = await this.judge.getDecrypted();
```

Then check if `userId` is still used elsewhere in the same method — if it's no longer used downstream, drop the parameter from the calling chain. Run:
```bash
grep -nE "userId" /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/api/src/modules/insights/synthesize.service.ts
```
If `userId` is still required for non-judge reasons (audit, scoping queries), leave the parameter; just remove the argument from `getDecrypted`.

- [ ] **Step 4: Type-check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/api type-check
```
Expected: green.

---

### Task 9: Update LlmJudgeService unit tests

**Files:**
- Modify: `apps/api/src/modules/llm-judge/llm-judge.service.spec.ts`

- [ ] **Step 1: Read the current test**

```bash
cat /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/api/src/modules/llm-judge/llm-judge.service.spec.ts
```
Note all `userId` references and any prisma mocks for `findUnique({where: {userId}})`.

- [ ] **Step 2: Rewrite each test case to drop userId**

For every test, remove the `userId` argument from service calls. Replace prisma mock setup:
- `findUnique({where: {userId}})` → `findFirst({orderBy: {updatedAt: 'desc'}})`
- `upsert({where: {userId}, …})` → `findFirst` + (`update({where: {id}, …})` OR `create({data: …})`)

Add at least one test that asserts: when two rows exist, `getPublic()` returns the row with the largest `updatedAt`.

- [ ] **Step 3: Run the unit tests**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/api test -- llm-judge.service
```
Expected: green.

---

### Task 10: Rewrite llm-judge e2e for global behavior

**Files:**
- Modify: `apps/api/test/e2e/llm-judge.e2e-spec.ts`

- [ ] **Step 1: Read the current e2e**

```bash
cat /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/api/test/e2e/llm-judge.e2e-spec.ts
```
Identify the existing two-user assertions (they rely on per-user isolation).

- [ ] **Step 2: Replace the per-user-isolation assertion with cross-user visibility**

Rewrite the test that previously asserted user A's config is invisible to user B. The new assertion: after user A creates a provider, **user B sees the same provider** via `GET /api/llm-judge/provider`.

Keep all other tests (CRUD, key-reuse-on-update, test endpoint) — just remove user-scoping setup if any.

Example replacement block:

```typescript
it("provider config is global — visible across users", async () => {
  // user A creates
  await request(app.getHttpServer())
    .put("/api/llm-judge/provider")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ baseUrl: "https://api.example.com/v1", apiKey: "sk-A", model: "x", enabled: true })
    .expect(200);

  // user B sees it
  const r = await request(app.getHttpServer())
    .get("/api/llm-judge/provider")
    .set("Authorization", `Bearer ${tokenB}`)
    .expect(200);
  expect(r.body?.baseUrl).toBe("https://api.example.com/v1");
});

it("user B can update the same global config", async () => {
  await request(app.getHttpServer())
    .put("/api/llm-judge/provider")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({ baseUrl: "https://api.example.com/v2", model: "y", enabled: true })
    .expect(200);

  const r = await request(app.getHttpServer())
    .get("/api/llm-judge/provider")
    .set("Authorization", `Bearer ${tokenA}`)
    .expect(200);
  expect(r.body?.baseUrl).toBe("https://api.example.com/v2");
  expect(r.body?.model).toBe("y");
});
```

- [ ] **Step 3: Run llm-judge + insights e2e**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm test:e2e:api -- llm-judge.e2e-spec.ts insights.e2e-spec.ts
```
Expected: all green.

- [ ] **Step 4: Commit Phase 3**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
git add apps/api/src/modules/llm-judge \
        apps/api/src/modules/insights/synthesize.service.ts \
        apps/api/test/e2e/llm-judge.e2e-spec.ts
git commit -m "$(cat <<'EOF'
refactor(api): LlmJudgeProvider becomes a global singleton

Drop userId from service/controller signatures; reads use findFirst
ordered by updatedAt desc, writes update-in-place or create. Insights
synthesizer no longer scopes the judge provider by user. e2e now
asserts the config is visible across users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Web: `/me` page

### Task 11: `me` locale namespace + i18n registration

**Files:**
- Create: `apps/web/src/locales/en-US/me.json`
- Create: `apps/web/src/locales/zh-CN/me.json`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] **Step 1: Write en-US/me.json**

```json
{
  "page": {
    "title": "Profile",
    "subtitle": "Your account profile and password"
  },
  "profile": {
    "title": "Profile",
    "description": "Identity displayed across the app.",
    "email": "Email",
    "displayName": "Display name",
    "displayNamePlaceholder": "Your name",
    "avatar": "Avatar",
    "avatarHint": "PNG / JPG up to 200KB.",
    "avatarUpload": "Upload image",
    "avatarRemove": "Remove",
    "save": "Save profile",
    "saveSuccess": "Profile updated"
  },
  "password": {
    "title": "Password",
    "description": "Change the password used to sign in.",
    "current": "Current password",
    "next": "New password",
    "confirm": "Confirm new password",
    "submit": "Update password",
    "success": "Password updated",
    "errorMismatch": "New passwords do not match",
    "errorSame": "New password must differ from the current one",
    "errorWrong": "Current password is incorrect"
  },
  "notifications": {
    "page": {
      "title": "Notifications",
      "subtitle": "Channels and event subscriptions for your account.",
      "breadcrumb": "Notifications"
    }
  }
}
```

- [ ] **Step 2: Write zh-CN/me.json**

```json
{
  "page": {
    "title": "个人中心",
    "subtitle": "个人账号资料与密码"
  },
  "profile": {
    "title": "个人资料",
    "description": "在应用中展示的身份信息。",
    "email": "邮箱",
    "displayName": "显示名",
    "displayNamePlaceholder": "请输入显示名",
    "avatar": "头像",
    "avatarHint": "支持 PNG / JPG，单文件不超过 200KB。",
    "avatarUpload": "上传图片",
    "avatarRemove": "移除",
    "save": "保存资料",
    "saveSuccess": "资料已更新"
  },
  "password": {
    "title": "密码",
    "description": "修改登录密码。",
    "current": "当前密码",
    "next": "新密码",
    "confirm": "确认新密码",
    "submit": "更新密码",
    "success": "密码已更新",
    "errorMismatch": "两次输入的新密码不一致",
    "errorSame": "新密码不能与当前密码相同",
    "errorWrong": "当前密码不正确"
  },
  "notifications": {
    "page": {
      "title": "通知",
      "subtitle": "属于你账号的渠道与事件订阅。",
      "breadcrumb": "通知"
    }
  }
}
```

- [ ] **Step 3: Register namespace in i18n.ts**

Open `apps/web/src/lib/i18n.ts`. Add imports following the existing pattern:

```typescript
import enMe from "@/locales/en-US/me.json";
import zhMe from "@/locales/zh-CN/me.json";
```

In the `resources` object, add `me: enMe` (en-US) and `me: zhMe` (zh-CN). Add `"me"` to the `ns` array if one exists.

- [ ] **Step 4: Type-check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/web type-check
```
Expected: green.

---

### Task 12: react-query hooks for /me

**Files:**
- Create: `apps/web/src/features/me/queries.ts`

- [ ] **Step 1: Write the hooks**

```typescript
import { api } from "@/lib/api";
import type { ChangePasswordRequest, PublicUser, UpdateProfileRequest } from "@modeldoctor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const AUTH_ME_KEY = ["auth", "me"] as const;

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => api.patch<PublicUser>("/api/me", body),
    onSuccess: (u) => {
      qc.setQueryData(AUTH_ME_KEY, u);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => api.post<void>("/api/me/password", body),
  });
}
```

If `api.patch` doesn't exist in `apps/web/src/lib/api.ts`, add it — mirror the existing `api.post` implementation.

- [ ] **Step 2: Verify api helper supports PATCH**

```bash
grep -n "patch\|del" /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/web/src/lib/api.ts
```
If `patch` is missing, add it next to `post`:

```typescript
patch<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
}
```

(Match the exact pattern of `post` — same headers, same error mapping.)

---

### Task 13: Sync auth-store from PATCH responses

**Files:**
- Modify: `apps/web/src/features/me/queries.ts` (extend `useUpdateProfile.onSuccess`)
- Modify: `apps/web/src/stores/auth-store.ts` (add `setUser`)

- [ ] **Step 1: Add `setUser` to auth-store**

In `auth-store.ts`, extend `AuthState`:

```typescript
setUser: (user: PublicUser) => void;
```

And in the `create` body:

```typescript
setUser: (user) => set({ user }),
```

- [ ] **Step 2: Call setUser from useUpdateProfile**

Update `useUpdateProfile.onSuccess` to also write into the auth store so the sidebar avatar refreshes immediately:

```typescript
onSuccess: (u) => {
  qc.setQueryData(AUTH_ME_KEY, u);
  useAuthStore.getState().setUser(u);
},
```

Add the import: `import { useAuthStore } from "@/stores/auth-store";`

---

### Task 14: ProfileSection (avatar + displayName + email)

**Files:**
- Create: `apps/web/src/features/me/ProfileSection.tsx`
- Create: `apps/web/src/features/me/AvatarUpload.tsx`

- [ ] **Step 1: AvatarUpload component**

Write `apps/web/src/features/me/AvatarUpload.tsx`:

```typescript
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useRef } from "react";

const MAX_BYTES = 200 * 1024;

function initialsFor(email: string, displayName: string | null): string {
  const src = displayName?.trim() || email;
  return src.slice(0, 2).toUpperCase();
}

interface Props {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  onChange: (next: string | null) => void;
  pending?: boolean;
}

export function AvatarUpload({ email, displayName, avatarUrl, onChange, pending }: Props) {
  const { t } = useTranslation("me");
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t("profile.avatarHint"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") onChange(result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-start gap-4">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-muted-foreground">
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
        ) : (
          <span>{initialsFor(email, displayName)}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {t("profile.avatarUpload")}
          </Button>
          {avatarUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onChange(null)}
            >
              {t("profile.avatarRemove")}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("profile.avatarHint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ProfileSection component**

Write `apps/web/src/features/me/ProfileSection.tsx`:

```typescript
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormSection } from "@/components/common/form-section";
import { useAuthStore } from "@/stores/auth-store";
import { zodResolver } from "@hookform/resolvers/zod";
import { type UpdateProfileRequest, UpdateProfileRequestSchema } from "@modeldoctor/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AvatarUpload } from "./AvatarUpload";
import { useUpdateProfile } from "./queries";

export function ProfileSection() {
  const { t } = useTranslation("me");
  const user = useAuthStore((s) => s.user);
  const update = useUpdateProfile();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);

  const form = useForm<UpdateProfileRequest>({
    mode: "onTouched",
    resolver: zodResolver(UpdateProfileRequestSchema),
    defaultValues: { displayName: user?.displayName ?? "" },
  });

  if (!user) return null;

  async function onSubmit(values: UpdateProfileRequest) {
    await update.mutateAsync({
      displayName: values.displayName?.trim() ? values.displayName.trim() : null,
      avatarUrl,
    });
    toast.success(t("profile.saveSuccess"));
  }

  return (
    <FormSection title={t("profile.title")} description={t("profile.description")}>
      <div className="space-y-4">
        <div>
          <div className="text-sm font-medium">{t("profile.email")}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
        </div>
        <AvatarUpload
          email={user.email}
          displayName={user.displayName}
          avatarUrl={avatarUrl}
          onChange={setAvatarUrl}
          pending={update.isPending}
        />
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("profile.displayName")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("profile.displayNamePlaceholder")}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      className="max-w-md"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={update.isPending}>
              {t("profile.save")}
            </Button>
          </form>
        </Form>
      </div>
    </FormSection>
  );
}
```

---

### Task 15: PasswordSection

**Files:**
- Create: `apps/web/src/features/me/PasswordSection.tsx`
- Create: `apps/web/src/features/me/PasswordSection.test.tsx`

- [ ] **Step 1: Write PasswordSection**

```typescript
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormSection } from "@/components/common/form-section";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChangePasswordRequestSchema } from "@modeldoctor/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { useChangePassword } from "./queries";

const FormSchema = ChangePasswordRequestSchema.extend({
  confirmPassword: z.string().min(8).max(200),
}).refine((v) => v.newPassword === v.confirmPassword, {
  message: "errorMismatch",
  path: ["confirmPassword"],
});
type FormValues = z.infer<typeof FormSchema>;

export function PasswordSection() {
  const { t } = useTranslation("me");
  const change = useChangePassword();
  const form = useForm<FormValues>({
    mode: "onTouched",
    resolver: zodResolver(FormSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await change.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success(t("password.success"));
      form.reset();
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      if (status === 401) toast.error(t("password.errorWrong"));
      else if (status === 400) toast.error(t("password.errorSame"));
      else toast.error(String(e?.message ?? e));
    }
  }

  return (
    <FormSection title={t("password.title")} description={t("password.description")}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("password.current")}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("password.next")}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("password.confirm")}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage>
                  {form.formState.errors.confirmPassword?.message === "errorMismatch"
                    ? t("password.errorMismatch")
                    : form.formState.errors.confirmPassword?.message}
                </FormMessage>
              </FormItem>
            )}
          />
          <Button type="submit" disabled={change.isPending}>
            {t("password.submit")}
          </Button>
        </form>
      </Form>
    </FormSection>
  );
}
```

- [ ] **Step 2: Write the test**

Write `apps/web/src/features/me/PasswordSection.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { PasswordSection } from "./PasswordSection";

vi.mock("./queries", () => ({
  useChangePassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PasswordSection />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("PasswordSection", () => {
  it("renders all three password fields", () => {
    renderIt();
    expect(screen.getAllByLabelText(/password/i).length).toBeGreaterThanOrEqual(3);
  });

  it("shows mismatch error when confirm differs from new", async () => {
    renderIt();
    const inputs = screen.getAllByRole("textbox", { hidden: true });
    // password fields are not textbox role; query by label instead
    const newPw = screen.getByLabelText(/new password/i);
    const confirm = screen.getByLabelText(/confirm/i);
    fireEvent.change(newPw, { target: { value: "abcdefgh" } });
    fireEvent.change(confirm, { target: { value: "different1" } });
    fireEvent.blur(confirm);
    await waitFor(() => {
      expect(screen.getByText(/do not match|不一致/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/web test -- PasswordSection
```
Expected: green.

---

### Task 16: MePage assembly + route

**Files:**
- Create: `apps/web/src/features/me/MePage.tsx`
- Create: `apps/web/src/features/me/MePage.test.tsx`
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 1: Write MePage**

```typescript
import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";

export function MePage(): JSX.Element {
  const { t } = useTranslation("me");
  return (
    <>
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />
      <div className="px-8 py-6 space-y-8">
        <ProfileSection />
        <PasswordSection />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Register the `/me` route**

Open `apps/web/src/router/index.tsx`:

- Add the import at the top (alongside existing `@/features/*` imports):
  ```typescript
  import { MePage } from "@/features/me/MePage";
  ```
- Add a new route row inside the children array, **immediately before** the existing `{ path: "settings", ... }` line:
  ```typescript
  { path: "me", element: <MePage /> },
  ```
(The `/me/notifications` route + `/settings/notifications` redirect are added in Task 17, after `MeNotificationsPage` exists.)

- [ ] **Step 3: Smoke test MePage rendering**

Write `apps/web/src/features/me/MePage.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/lib/i18n";
import { useAuthStore } from "@/stores/auth-store";
import { MePage } from "./MePage";

function renderIt() {
  useAuthStore.setState({
    accessToken: "x",
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "u1",
      email: "a@b.c",
      roles: [],
      displayName: null,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MePage />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("MePage", () => {
  it("renders Profile + Password sections", () => {
    renderIt();
    expect(screen.getByText(/Profile|个人资料/)).toBeInTheDocument();
    expect(screen.getByText(/Password|密码/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run web tests**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/web test -- features/me
```
Expected: green.

---

## Phase 5 — Web: notifications → /me/notifications, settings cleanup, sidebar avatar

### Task 17: Port SettingsNotificationsPage → MeNotificationsPage at `/me/notifications`

**Files:**
- Create: `apps/web/src/features/me/MeNotificationsPage.tsx`
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 1: Read the current SettingsNotificationsPage**

```bash
sed -n '1,160p' /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/web/src/features/settings/NotificationsPage.tsx
```
Note: title/subtitle/breadcrumb keys come from the `settings` namespace today. The new page uses the `me` namespace instead, and the breadcrumb roots on `/me` rather than `/settings`. Everything else (table layout, sheet, delete dialog) is preserved verbatim.

- [ ] **Step 2: Write MeNotificationsPage**

Write `apps/web/src/features/me/MeNotificationsPage.tsx`:

```typescript
import { PageHeader } from "@/components/common/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChannelSheet } from "@/features/notifications/ChannelSheet";
import { useChannels, useDeleteChannel, useTestChannel } from "@/features/notifications/queries";
import type { Channel } from "@modeldoctor/contracts";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function MeNotificationsPage(): JSX.Element {
  const { t: tMe } = useTranslation("me");
  const { t: tn } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { t: tSidebar } = useTranslation("sidebar");
  const { data = [] } = useChannels();
  const del = useDeleteChannel();
  const testCh = useTestChannel();
  const [editing, setEditing] = useState<Channel | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Channel | null>(null);

  const onTest = async (c: Channel) => {
    const res = await testCh.mutateAsync(c.id);
    if (res.ok) toast.success(tn("channel.testSuccess"));
    else toast.error(tn("channel.testFailure", { error: res.error ?? "" }));
  };

  const breadcrumbs = [
    { label: tSidebar("items.profile"), to: "/me" },
    { label: tMe("notifications.page.breadcrumb") },
  ];

  return (
    <>
      <PageHeader
        title={tMe("notifications.page.title")}
        subtitle={tMe("notifications.page.subtitle")}
        breadcrumbs={breadcrumbs}
        rightSlot={
          <Button size="sm" onClick={() => setEditing(null)}>
            {tn("channel.newButton")}
          </Button>
        }
      />
      <div className="px-8 py-6">
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tn("channel.columns.name")}</TableHead>
                <TableHead>{tn("channel.columns.type")}</TableHead>
                <TableHead>{tn("channel.columns.createdAt")}</TableHead>
                <TableHead className="w-[160px] text-right">
                  {tn("channel.columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium text-foreground hover:underline"
                      onClick={() => setEditing(c)}
                    >
                      {c.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.type}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onTest(c)}
                      disabled={testCh.isPending}
                    >
                      {tn("channel.testButton")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tn("channel.editButton")}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tn("channel.deleteButton")}
                      onClick={() => setToDelete(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <ChannelSheet
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        channel={editing ?? null}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tn("delete.channelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tn("delete.channelDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) await del.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
            >
              {tn("channel.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 3: Wire `/me/notifications` route and redirect `/settings/notifications`**

Open `apps/web/src/router/index.tsx`:

- Add at the top:
  ```typescript
  import { MeNotificationsPage } from "@/features/me/MeNotificationsPage";
  ```
- Remove the `SettingsNotificationsPage` import (line 29).
- Replace the existing row:
  ```typescript
  { path: "settings/notifications", element: <SettingsNotificationsPage /> },
  ```
  with:
  ```typescript
  { path: "me/notifications", element: <MeNotificationsPage /> },
  { path: "settings/notifications", element: <Navigate to="/me/notifications" replace /> },
  ```

- [ ] **Step 4: Type-check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/web type-check
```
Expected: green.

---

### Task 18: Remove the Settings summary card; delete legacy files

**Files:**
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Delete: `apps/web/src/features/settings/NotificationsPage.tsx`
- Delete: `apps/web/src/features/settings/NotificationsSettingsSection.tsx`

- [ ] **Step 1: Remove `<NotificationsSettingsSection />` from SettingsPage**

Edit `apps/web/src/features/settings/SettingsPage.tsx`:
- Delete the import on line 31:
  ```typescript
  import { NotificationsSettingsSection } from "./NotificationsSettingsSection";
  ```
- Delete the JSX render on line 106:
  ```jsx
  <NotificationsSettingsSection />
  ```

- [ ] **Step 2: Delete legacy files**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
rm apps/web/src/features/settings/NotificationsPage.tsx
rm apps/web/src/features/settings/NotificationsSettingsSection.tsx
```

- [ ] **Step 3: Confirm no remaining importers**

```bash
grep -rn "SettingsNotificationsPage\|NotificationsSettingsSection" \
  /Users/fangyong/vllm/modeldoctor/feat-user-center/apps/web/src \
  /Users/fangyong/vllm/modeldoctor/feat-user-center/e2e 2>/dev/null
```
Expected: no matches. If Playwright specs reference the old route URL string `/settings/notifications`, leave them — the redirect handles them; just verify in the smoke test.

- [ ] **Step 4: Run web tests + type-check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/web type-check
```
Expected: green.

---

### Task 19: Sidebar avatar dropdown (with /me link)

**Files:**
- Modify: `apps/web/src/components/sidebar/Sidebar.tsx`
- Modify: `apps/web/src/locales/en-US/sidebar.json`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json`

(Note: `sidebar-config.tsx` does NOT need editing — the `/notifications` primary item was already removed by #171.)

- [ ] **Step 1: Add `items.profile` + `items.logout` to sidebar locales**

In both `apps/web/src/locales/en-US/sidebar.json` and `apps/web/src/locales/zh-CN/sidebar.json`, under `items`:
- Add `profile`: `"Profile"` / `"个人中心"`.
- Add `logout`: `"Logout"` / `"退出登录"`.

(Run `cat` on both files first to confirm existing structure and whether these keys are already present.)

- [ ] **Step 2: Replace email/logout panel with avatar + dropdown**

Open `apps/web/src/components/sidebar/Sidebar.tsx`. Replace the entire `{userEmail ? (...) : null}` block (the bottom user panel currently emitting email + logout button — lines ~254–292) with:

```tsx
{userEmail ? (
  <UserPanel railCollapsed={railCollapsed} />
) : null}
```

Then add this helper component **above** `export function Sidebar()`:

```tsx
function initialsFor(email: string, displayName: string | null): string {
  const src = displayName?.trim() || email;
  return src.slice(0, 2).toUpperCase();
}

function UserPanel({ railCollapsed }: { railCollapsed: boolean }) {
  const { t: tSidebar } = useTranslation("sidebar");
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const label = user.displayName?.trim() || user.email;

  const avatar = (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsFor(user.email, user.displayName)
      )}
    </div>
  );

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          "flex w-full items-center rounded-md text-sm",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          railCollapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-1.5",
        )}
        aria-label={label}
      >
        {avatar}
        {railCollapsed ? null : (
          <span className="min-w-0 flex-1 truncate text-left text-xs">{label}</span>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <div className="border-b border-border px-2 py-2">
      <DropdownMenu>
        {railCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent side="top" align="start" className="min-w-[10rem]">
          <DropdownMenuItem asChild>
            <NavLink to="/me">{tSidebar("items.profile")}</NavLink>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            <span>{tSidebar("items.logout")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 3: Type-check + tests**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/web test -- sidebar
pnpm -F @modeldoctor/web type-check
```
Expected: green.

- [ ] **Step 4: Commit Phase 4 + Phase 5**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
git add apps/web/src/features/me \
        apps/web/src/locales/en-US/me.json apps/web/src/locales/zh-CN/me.json \
        apps/web/src/lib/i18n.ts \
        apps/web/src/lib/api.ts \
        apps/web/src/stores/auth-store.ts \
        apps/web/src/router/index.tsx \
        apps/web/src/features/settings/SettingsPage.tsx \
        apps/web/src/components/sidebar/Sidebar.tsx \
        apps/web/src/locales/en-US/sidebar.json apps/web/src/locales/zh-CN/sidebar.json
git rm apps/web/src/features/settings/NotificationsPage.tsx \
       apps/web/src/features/settings/NotificationsSettingsSection.tsx
git commit -m "$(cat <<'EOF'
feat(web): user center (/me) + notifications moved to /me/notifications

Re-personalizes the notification IA (post #171): channels table moves
from /settings/notifications to /me/notifications. Adds /me identity
page (avatar + displayName + password). Settings page loses the
notifications summary card. Sidebar bottom-bar gets an avatar dropdown
with Profile + Logout. /settings/notifications redirects to
/me/notifications for back-compat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Settings copy + AI global tag

### Task 19: Settings i18n tweak

**Files:**
- Modify: `apps/web/src/locales/en-US/settings.json`
- Modify: `apps/web/src/locales/zh-CN/settings.json`

- [ ] **Step 1: Update AI section description to emphasize global**

In `en-US/settings.json`, find the `ai` block and adjust:
```json
"ai": {
  "title": "AI Diagnostics (Global)",
  "description": "Workspace-wide LLM provider used by AI-assisted insights. Shared by all users in this installation.",
  ...
}
```

In `zh-CN/settings.json`:
```json
"ai": {
  "title": "AI 诊断（全局）",
  "description": "本实例所有用户共享的 LLM 提供方，用于 AI 辅助洞察。",
  ...
}
```
Keep all other `ai.*` keys untouched (`enabled`, `baseUrl`, `model`, `apiKey`, …).

- [ ] **Step 2: Type-check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/locales/en-US/settings.json apps/web/src/locales/zh-CN/settings.json
git commit -m "$(cat <<'EOF'
docs(web): mark AI Diagnostics as a global / workspace-wide setting

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Full verification + PR

### Task 20: Run the full test matrix

**Files:**
- N/A

- [ ] **Step 1: Lint + format**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
pnpm lint
pnpm format
```
Expected: clean. Commit any auto-formatting under `chore: biome format`.

- [ ] **Step 2: Type-check the whole workspace**

```bash
pnpm -r type-check
```
Expected: green.

- [ ] **Step 3: Unit + component tests**

```bash
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/contracts test
```
Expected: green. Per memory rule "Reap dev/test processes between subagents": tests must run one-shot, no watch mode.

- [ ] **Step 4: API e2e**

```bash
pnpm test:e2e:api
```
Expected: green — especially `auth.e2e-spec.ts`, `me.e2e-spec.ts`, `llm-judge.e2e-spec.ts`, `insights.e2e-spec.ts`, `notifications.e2e-spec.ts`.

- [ ] **Step 5: Browser e2e (Playwright)**

```bash
pnpm -r build  # ensure contracts/dist + api dist exist
pnpm test:e2e:browser
```
Expected: green.

- [ ] **Step 6: Manual smoke in dev**

```bash
pnpm dev
```
In a browser at `http://localhost:5173`:
1. Log in / register a fresh user; confirm sidebar bottom shows the avatar dropdown (initials when no avatar).
2. Navigate to `/me` via the dropdown's *Profile* item; change displayName, upload a small PNG → reload, persists; sidebar avatar updates immediately (within ~100ms of save).
3. Change password to a new value; log out via the dropdown; log back in with the new password.
4. Open `/settings` → confirm the "Notifications" summary card is gone; AI Diagnostics now reads "Global"; save a baseUrl/model/apiKey.
5. Register a SECOND user, log in as them, open `/settings` → confirm the same AI config is visible.
6. As user A, navigate to `/me/notifications` from the dropdown's *Profile* page (or directly); create a Slack channel; confirm it appears.
7. Visit `/settings/notifications` directly → must redirect to `/me/notifications`.

Kill the dev server after.

---

### Task 21: Open the PR

**Files:**
- N/A

- [ ] **Step 1: Push the branch**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-user-center
git push -u origin feat/user-center-and-global-ai-judge
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: user center + global AI Diagnostics" --body "$(cat <<'EOF'
## Summary

- New **`/me`** page: profile (avatar + displayName + email view) and change password.
- **`/me/notifications`**: notification channels + per-channel subscriptions — moved here from `/settings/notifications` (re-personalizes the IA introduced in #171). `/settings/notifications` redirects to `/me/notifications`.
- **`LlmJudgeProvider`** is now a **global singleton**; AI Diagnostics in `/settings` is shared by every user in the installation (label updated to *Global*).
- Sidebar bottom-bar replaces the email/logout chip with a dropdown rooted in the user avatar (Profile / Logout).
- Settings page loses the "Notifications" summary card; legacy `SettingsNotificationsPage` + `NotificationsSettingsSection` deleted.

## Schema

- `users` += `display_name TEXT NULL`, `avatar_url TEXT NULL`.
- `llm_judge_providers` -= `user_id` (FK + unique index dropped). Migration collapses the table to one row (most-recently-updated wins).

## Test plan

- [ ] `pnpm lint && pnpm -r type-check`
- [ ] `pnpm -F @modeldoctor/api test && pnpm -F @modeldoctor/web test && pnpm -F @modeldoctor/contracts test`
- [ ] `pnpm test:e2e:api`
- [ ] `pnpm test:e2e:browser`
- [ ] Manual: register, change profile, change password, log out / back in with new password.
- [ ] Manual: as user A, save AI Diagnostics; as user B, confirm the same config is visible & editable.
- [ ] Manual: `/settings/notifications` redirects to `/me/notifications`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Follow through on PR signals**

Per CLAUDE.md PR follow-through:
```bash
PR=$(gh pr view --json number -q .number)
gh pr view "$PR" --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks "$PR"
```
Wait for CI to settle; surface any failing checks back to the user.

---

## Self-review checklist

- [x] **Spec coverage:** User center (avatar + password + displayName) ✔︎. AI Diagnostics global ✔︎. Notifications IA move ✔︎. Theme stays put — by design (no spec change).
- [x] **No placeholders:** All code blocks complete; no "implement later" / "similar to Task N" references.
- [x] **Type consistency:** `PublicUser` extended once in contracts and used uniformly by API, web auth-store, and UI components. `LlmJudgeProvider` service signatures are consistent across service / controller / call site / tests.
- [x] **Migration safety:** Migration is schema-only (CLAUDE.md rule). No `INSERT`/`UPDATE`/`DELETE` of business data; service-side `findFirst` tolerates leftover rows. Dev-DB drift surfaced before applying.
- [x] **Single PR with phase-per-commit:** five commits planned (plan / schema+migration / api me / api llm-judge global / web me+sidebar / settings copy) plus a final lint commit if needed.
