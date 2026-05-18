# PrometheusDatasource Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a system-level `PrometheusDatasource` entity (admin-managed in Settings) with default selector, bind it onto `Connection` via optional FK, and wire `AlertExplainerService` to actually query the bound Prometheus for the alert's own expr — replacing the placeholder `Connection.prometheusUrl` and removing `kind=prometheus` from the Connection enum.

**Architecture:**
- Schema: new `prometheus_datasources` table (no `user_id`, `name`/`baseUrl` globally unique, partial unique index for `is_default`); `connection.prometheus_datasource_id` FK with `onDelete: SetNull`; drop `connection.prometheus_url`; narrow `connection.kind` enum to `[model, gateway, alertmanager]`.
- API: new `/api/prometheus-datasources` CRUD + `set-default` + `verify`; admin-only on mutations via existing `actorFrom` pattern. Connection create/update gains three-state field semantics (`undefined` → fill default; `null` → unbind; id → use).
- Web: new `/settings/prometheus-datasources` list page + `DatasourceSheet` (sheet, mirrors `ConnectionSheet` shape); `ConnectionSheet` adds "指标源" select for `kind ∈ {model, gateway}`.
- Explainer: new `PrometheusFetcherService` runs alert's expr (`annotations.expr` or `generatorURL?g0.expr=`) via `query_range` over `[startsAt-15min, startsAt+5min]`, summarises ≤5 series, fails open to baseline-only.
- MCP: `list_prometheus_datasources` + `set_connection_prometheus_source`.

**Tech Stack:** NestJS 10, Prisma 6, zod, Vitest 2, React + TanStack Router, shadcn/ui, react-query 5.

**Working directory:** `/Users/fangyong/vllm/modeldoctor/feat-prometheus-datasource`. Branch: `feat/prometheus-datasource`.

**Single PR / phase-per-commit** per `feedback_single_pr_for_coupled_work`. PR title: `feat: PrometheusDatasource — admin-managed 指标源 + Connection 绑定 + AI explainer Prom 接入 (addresses #189)`.

---

## Pre-flight (run once before Task 1)

Fresh worktree needs install + build (per `project_worktree_build_first`):

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-prometheus-datasource
pnpm install
pnpm -r build
```

Expected: clean install, all packages build (`packages/contracts/dist/` populated).

If `pnpm install` or build fails, **stop and surface** — do not proceed.

---

## File Structure

### Contracts (Task 1)
- **Create** `packages/contracts/src/prometheus-datasource.ts` — zod schemas
- **Create** `packages/contracts/src/prometheus-datasource.spec.ts`
- **Modify** `packages/contracts/src/connection.ts` — narrow `connectionKindSchema` to 3 values; add `prometheusDatasourceId` to public + create + update; drop `prometheusUrl`
- **Modify** `packages/contracts/src/connection.spec.ts` — flip prometheus-kind expectations
- **Modify** `packages/contracts/src/index.ts` — re-export new file

### API schema + migration (Task 2)
- **Modify** `apps/api/prisma/schema.prisma`
- **Create** `apps/api/prisma/migrations/<timestamp>_prometheus_datasource/migration.sql`

### API CRUD module (Task 3)
- **Create** `apps/api/src/modules/prometheus-datasource/prometheus-datasource.module.ts`
- **Create** `apps/api/src/modules/prometheus-datasource/prometheus-datasource.service.ts`
- **Create** `apps/api/src/modules/prometheus-datasource/prometheus-datasource.controller.ts`
- **Create** `apps/api/src/modules/prometheus-datasource/prometheus-datasource.service.spec.ts`
- **Create** `apps/api/src/modules/prometheus-datasource/prometheus-datasource.controller.spec.ts`
- **Create** `apps/api/test/e2e/prometheus-datasource.e2e-spec.ts`
- **Modify** `apps/api/src/app.module.ts` — import new module
- **Modify** `apps/api/src/modules/connection/discovery/verify-kind.ts` — export `verifyPrometheus` as a public helper (for reuse from `/verify` endpoint); drop the `kind === "prometheus"` switch branch from `verifyConnection`

### Connection three-state + cleanup (Task 4)
- **Modify** `apps/api/src/modules/connection/connection.service.ts` — accept/store/return `prometheusDatasourceId`; auto-fill default; reject `kind=alertmanager` + non-null source; remove `prometheusUrl` field; include `_count` on list query if needed
- **Modify** `apps/api/src/modules/connection/connection.service.spec.ts`
- **Modify** `apps/api/test/e2e/connection-kind.e2e-spec.ts` — drop `kind=prometheus` cases, add three-state cases

### Explainer + PrometheusFetcher (Task 5)
- **Create** `apps/api/src/modules/alerts/prometheus-fetcher.service.ts`
- **Create** `apps/api/src/modules/alerts/prometheus-fetcher.service.spec.ts`
- **Modify** `apps/api/src/modules/alerts/explainer.service.ts`
- **Modify** `apps/api/src/modules/alerts/explainer.service.spec.ts`
- **Modify** `apps/api/src/modules/alerts/alerts.module.ts`
- **Modify** `apps/api/test/e2e/alerts.e2e-spec.ts`

### Web settings page + Sheet (Task 6)
- **Create** `apps/web/src/features/prometheus-datasources/queries.ts`
- **Create** `apps/web/src/features/prometheus-datasources/queries.test.tsx`
- **Create** `apps/web/src/features/prometheus-datasources/DatasourcesPage.tsx`
- **Create** `apps/web/src/features/prometheus-datasources/DatasourcesPage.test.tsx`
- **Create** `apps/web/src/features/prometheus-datasources/DatasourceSheet.tsx`
- **Create** `apps/web/src/features/prometheus-datasources/DatasourceSheet.test.tsx`
- **Create** `apps/web/src/locales/zh-CN/prometheus-datasources.json`
- **Create** `apps/web/src/locales/en-US/prometheus-datasources.json`
- **Modify** `apps/web/src/router/index.tsx` — add route
- **Modify** `apps/web/src/features/settings/SettingsPage.tsx` — add entry SettingSection
- **Modify** `apps/web/src/lib/i18n.ts` — register namespace

### Connection form + list updates (Task 7)
- **Modify** `apps/web/src/features/connections/ConnectionSheet.tsx`
- **Modify** `apps/web/src/features/connections/ConnectionSheet.test.tsx`
- **Modify** `apps/web/src/features/connections/ConnectionsPage.tsx`
- **Modify** `apps/web/src/features/connections/ConnectionsPage.test.tsx`
- **Modify** `apps/web/src/features/connections/schema.ts` (if it duplicates contract shape — mirror change)

### MCP tools (Task 8)
- **Create** `apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.ts`
- **Create** `apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.spec.ts`
- **Create** `apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.ts`
- **Create** `apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.spec.ts`
- **Modify** `apps/api/src/modules/mcp/tools/_register.ts`
- **Modify** `apps/api/src/modules/mcp/tools/list-connections.tool.ts` — description `prometheusUrl` → `prometheusDatasource`
- **Modify** `apps/api/src/modules/mcp/README.md` — append 2 tool sections

### Final cross-cuts (Task 9)
- Manual smoke + PR opening + follow-up comment on #189

---

## Task 1: Contracts — zod schemas + narrow Connection.kind enum

**Files:**
- Create: `packages/contracts/src/prometheus-datasource.ts`
- Create: `packages/contracts/src/prometheus-datasource.spec.ts`
- Modify: `packages/contracts/src/connection.ts`
- Modify: `packages/contracts/src/connection.spec.ts`
- Modify: `packages/contracts/src/index.ts`

### Step 1.1: Write `prometheus-datasource.spec.ts` (failing first)

```ts
// packages/contracts/src/prometheus-datasource.spec.ts
import { describe, expect, it } from "vitest";
import {
  createPrometheusDatasourceSchema,
  prometheusDatasourcePublicSchema,
  prometheusDatasourceWithSecretSchema,
  updatePrometheusDatasourceSchema,
  verifyPrometheusDatasourceRequestSchema,
  verifyPrometheusDatasourceResponseSchema,
} from "./prometheus-datasource.js";

describe("prometheusDatasourcePublicSchema", () => {
  it("accepts a minimal row", () => {
    const row = {
      id: "cuid_abc",
      name: "primary",
      baseUrl: "https://prom.example.com",
      bearerPreview: "",
      customHeaders: "",
      isDefault: true,
      consumersCount: 0,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T10:00:00.000Z",
    };
    expect(prometheusDatasourcePublicSchema.parse(row)).toEqual(row);
  });

  it("rejects non-url baseUrl", () => {
    expect(() =>
      prometheusDatasourcePublicSchema.parse({
        id: "x", name: "p", baseUrl: "not-a-url", bearerPreview: "",
        customHeaders: "", isDefault: false, consumersCount: 0,
        createdAt: "2026-05-18T10:00:00.000Z", updatedAt: "2026-05-18T10:00:00.000Z",
      })
    ).toThrow();
  });
});

describe("createPrometheusDatasourceSchema", () => {
  it("accepts minimal input (name + baseUrl)", () => {
    const parsed = createPrometheusDatasourceSchema.parse({
      name: "primary", baseUrl: "https://prom.example.com",
    });
    expect(parsed.name).toBe("primary");
    expect(parsed.isDefault).toBe(false);  // default
    expect(parsed.customHeaders).toBe("");
  });

  it("accepts bearerToken + customHeaders + isDefault", () => {
    const parsed = createPrometheusDatasourceSchema.parse({
      name: "secondary",
      baseUrl: "https://prom2.example.com",
      bearerToken: "abc123xyz",
      customHeaders: "X-Tenant: foo",
      isDefault: true,
    });
    expect(parsed.bearerToken).toBe("abc123xyz");
    expect(parsed.isDefault).toBe(true);
  });

  it("rejects empty name", () => {
    expect(() =>
      createPrometheusDatasourceSchema.parse({ name: "", baseUrl: "https://x" })
    ).toThrow();
  });

  it("rejects name with control chars in bearerToken", () => {
    expect(() =>
      createPrometheusDatasourceSchema.parse({
        name: "p", baseUrl: "https://x", bearerToken: "abc xyz",
      })
    ).toThrow();
  });
});

describe("updatePrometheusDatasourceSchema", () => {
  it("accepts partial", () => {
    expect(updatePrometheusDatasourceSchema.parse({ name: "renamed" })).toEqual({ name: "renamed" });
    expect(updatePrometheusDatasourceSchema.parse({})).toEqual({});
  });
});

describe("verifyPrometheusDatasourceRequestSchema", () => {
  it("requires baseUrl", () => {
    expect(() => verifyPrometheusDatasourceRequestSchema.parse({})).toThrow();
    expect(verifyPrometheusDatasourceRequestSchema.parse({ baseUrl: "https://x" }).baseUrl).toBe(
      "https://x",
    );
  });
});

describe("verifyPrometheusDatasourceResponseSchema", () => {
  it("ok with optional version", () => {
    expect(verifyPrometheusDatasourceResponseSchema.parse({ ok: true, version: "2.50" })).toEqual({
      ok: true, version: "2.50",
    });
    expect(verifyPrometheusDatasourceResponseSchema.parse({ ok: false, reason: "timeout" })).toEqual({
      ok: false, reason: "timeout",
    });
  });
});

describe("prometheusDatasourceWithSecretSchema", () => {
  it("extends public with plain bearerToken", () => {
    const row = prometheusDatasourceWithSecretSchema.parse({
      id: "cuid_abc", name: "p", baseUrl: "https://x", bearerPreview: "abc...wxyz",
      customHeaders: "", isDefault: false, consumersCount: 0,
      createdAt: "2026-05-18T10:00:00.000Z", updatedAt: "2026-05-18T10:00:00.000Z",
      bearerToken: "abcdefwxyz",
    });
    expect(row.bearerToken).toBe("abcdefwxyz");
  });
});
```

- [ ] **Step 1.2: Run failing tests**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-prometheus-datasource
pnpm -F @modeldoctor/contracts test -- prometheus-datasource
```

Expected: FAIL — `Cannot find module './prometheus-datasource.js'`.

- [ ] **Step 1.3: Create `prometheus-datasource.ts`**

```ts
// packages/contracts/src/prometheus-datasource.ts
import { z } from "zod";

const bearerTokenSchema = z
  .string()
  .refine((v) => !/\p{Cc}/u.test(v), {
    message: "bearerToken must not contain control characters",
  })
  .refine((v) => v === v.trim(), {
    message: "bearerToken must not have leading or trailing whitespace",
  });

export const prometheusDatasourcePublicSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  bearerPreview: z.string(),
  customHeaders: z.string(),
  isDefault: z.boolean(),
  consumersCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PrometheusDatasourcePublic = z.infer<typeof prometheusDatasourcePublicSchema>;

export const prometheusDatasourceWithSecretSchema = prometheusDatasourcePublicSchema.extend({
  bearerToken: z.string(),
});
export type PrometheusDatasourceWithSecret = z.infer<typeof prometheusDatasourceWithSecretSchema>;

export const createPrometheusDatasourceSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  bearerToken: bearerTokenSchema.optional(),
  customHeaders: z.string().default(""),
  isDefault: z.boolean().default(false),
});
export type CreatePrometheusDatasource = z.infer<typeof createPrometheusDatasourceSchema>;

export const updatePrometheusDatasourceSchema = createPrometheusDatasourceSchema.partial();
export type UpdatePrometheusDatasource = z.infer<typeof updatePrometheusDatasourceSchema>;

export const listPrometheusDatasourcesResponseSchema = z.object({
  items: z.array(prometheusDatasourcePublicSchema),
});
export type ListPrometheusDatasourcesResponse = z.infer<
  typeof listPrometheusDatasourcesResponseSchema
>;

export const verifyPrometheusDatasourceRequestSchema = z.object({
  baseUrl: z.string().url(),
  bearerToken: z.string().optional(),
  customHeaders: z.string().optional(),
});
export type VerifyPrometheusDatasourceRequest = z.infer<
  typeof verifyPrometheusDatasourceRequestSchema
>;

export const verifyPrometheusDatasourceResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  reason: z.string().optional(),
});
export type VerifyPrometheusDatasourceResponse = z.infer<
  typeof verifyPrometheusDatasourceResponseSchema
>;

/** Delete response — gives the consumer count detached so the UI can toast. */
export const deletePrometheusDatasourceResponseSchema = z.object({
  consumersDetached: z.number().int().min(0),
});
export type DeletePrometheusDatasourceResponse = z.infer<
  typeof deletePrometheusDatasourceResponseSchema
>;
```

- [ ] **Step 1.4: Re-export from `index.ts`**

Open `packages/contracts/src/index.ts`, find the existing `export * from "./connection.js";` line and add immediately below:

```ts
export * from "./prometheus-datasource.js";
```

- [ ] **Step 1.5: Run tests — should pass now**

```bash
pnpm -F @modeldoctor/contracts test -- prometheus-datasource
```

Expected: PASS (all describe blocks green).

- [ ] **Step 1.6: Modify `connection.ts` — narrow enum + add FK field + drop `prometheusUrl`**

Change:

```ts
// line 23
export const connectionKindSchema = z.enum(["model", "gateway", "alertmanager"]);
```

In `connectionPublicSchema` (around line 27-53):
- **delete** line `prometheusUrl: z.string().url().nullable(),`
- **add** before `serverKind`:
  ```ts
  prometheusDatasourceId: z.string().nullable(),
  prometheusDatasource: z
    .object({
      id: z.string(),
      name: z.string(),
      baseUrl: z.string().url(),
    })
    .nullable(),
  ```

In `createConnectionShape` (around line 73-89):
- **delete** line `prometheusUrl: z.string().url().nullable().optional(),`
- **add** (anywhere in the object):
  ```ts
  // Three-state binding: undefined → server fills with default datasource;
  // null → explicit unbind; string → must exist and connection.kind !== 'alertmanager'.
  prometheusDatasourceId: z.string().nullish(),
  ```

In `refineKindFields` (around line 94-118): add a new block to reject non-null `prometheusDatasourceId` for `kind === "alertmanager"`:

```ts
  if (v.kind === "alertmanager" && v.prometheusDatasourceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["prometheusDatasourceId"],
      message: "prometheusDatasourceId must be null for kind=alertmanager",
    });
  }
```

- [ ] **Step 1.7: Update `connection.spec.ts` — flip expectations**

Open `packages/contracts/src/connection.spec.ts`, find any test that uses `kind: "prometheus"` and either:
- delete it (no replacement for prometheus kind), or
- replace with `kind: "alertmanager"` if it was generic "non-model" coverage.

Add new tests:

```ts
describe("createConnectionSchema — prometheusDatasourceId", () => {
  it("rejects prometheusDatasourceId on kind=alertmanager", () => {
    expect(() =>
      createConnectionSchema.parse({
        kind: "alertmanager",
        name: "am",
        baseUrl: "https://am.example.com",
        prometheusDatasourceId: "ds_abc",
      }),
    ).toThrow();
  });

  it("accepts prometheusDatasourceId on kind=model", () => {
    const parsed = createConnectionSchema.parse({
      kind: "model",
      name: "m",
      baseUrl: "https://m.example.com",
      apiKey: "sk-abc",
      model: "gpt-4",
      category: "chat",
      prometheusDatasourceId: "ds_abc",
    });
    expect(parsed.prometheusDatasourceId).toBe("ds_abc");
  });

  it("accepts null prometheusDatasourceId (explicit unbind)", () => {
    const parsed = createConnectionSchema.parse({
      kind: "gateway",
      name: "g",
      baseUrl: "https://g.example.com",
      prometheusDatasourceId: null,
    });
    expect(parsed.prometheusDatasourceId).toBeNull();
  });

  it("accepts undefined prometheusDatasourceId (server fills)", () => {
    const parsed = createConnectionSchema.parse({
      kind: "gateway",
      name: "g",
      baseUrl: "https://g.example.com",
    });
    expect(parsed.prometheusDatasourceId).toBeUndefined();
  });
});

describe("connectionKindSchema", () => {
  it("only allows model/gateway/alertmanager", () => {
    expect(connectionKindSchema.options).toEqual(["model", "gateway", "alertmanager"]);
    expect(() => connectionKindSchema.parse("prometheus")).toThrow();
  });
});
```

- [ ] **Step 1.8: Run contracts tests**

```bash
pnpm -F @modeldoctor/contracts test
```

Expected: all green.

- [ ] **Step 1.9: Rebuild contracts dist (other packages import from it)**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: clean build.

- [ ] **Step 1.10: Commit**

```bash
git add packages/contracts/src/prometheus-datasource.ts \
        packages/contracts/src/prometheus-datasource.spec.ts \
        packages/contracts/src/connection.ts \
        packages/contracts/src/connection.spec.ts \
        packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): PrometheusDatasource zod schemas + Connection.kind 收窄

- New prometheus-datasource.ts: public/withSecret/create/update/verify/list/delete schemas
- connectionKindSchema 收窄到 [model, gateway, alertmanager]
- connectionPublicSchema: 删 prometheusUrl,加 prometheusDatasourceId + prometheusDatasource(摘要)
- createConnectionSchema: 接 prometheusDatasourceId(三态 nullish),refine 拒绝 kind=alertmanager 时非空

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: API — Prisma schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_prometheus_datasource/migration.sql` (Prisma-generated, then hand-augmented)

### Step 2.1: Modify `schema.prisma`

Open `apps/api/prisma/schema.prisma`. In `model Connection` (around line 67-117):

- **delete** lines 91-95 (the legacy `prometheusUrl` + adjacent comment):
  ```prisma
  // Reserved for #60 Prometheus integration. Nullable on purpose: existing
  // connections (created before this migration) have no value, and the UI
  // does not expose these fields yet.
  prometheusUrl String? @map("prometheus_url")
  serverKind    String? @map("server_kind") // see serverKindSchema in @modeldoctor/contracts
  ```
  **keep** `serverKind` — only delete `prometheusUrl`. So replace the 4 lines above with:
  ```prisma
  serverKind String? @map("server_kind") // see serverKindSchema in @modeldoctor/contracts
  ```

- **add** before `createdAt` (around line 103):
  ```prisma
  // FK to system-level Prometheus indstance scraping this connection's metrics.
  // Nullable: kind=alertmanager must be null; kind ∈ {model,gateway} may be
  // null (no source set) or fall back to PrometheusDatasource WHERE is_default.
  prometheusDatasourceId String?               @map("prometheus_datasource_id")
  prometheusDatasource   PrometheusDatasource? @relation(fields: [prometheusDatasourceId], references: [id], onDelete: SetNull)
  ```

- **add** after the existing `@@index` lines (or after the last relation field — typically before `@@map`):
  ```prisma
  @@index([prometheusDatasourceId])
  ```

At the end of `schema.prisma` (after the last model), append:

```prisma
// System-level Prometheus instance registered as a metrics source.
// Admin-managed via /api/prometheus-datasources; consumed by AlertExplainerService
// for query_range against alert exprs.
model PrometheusDatasource {
  id            String   @id @default(cuid())
  name          String   @unique
  baseUrl       String   @unique @map("base_url")
  bearerCipher  String   @default("") @map("bearer_cipher") // AES-256-GCM v1 (same key as connection.apiKeyCipher), empty = anonymous
  customHeaders String   @default("") @map("custom_headers")
  isDefault     Boolean  @default(false) @map("is_default")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  consumers Connection[]

  @@map("prometheus_datasources")
}
```

(The partial unique index on `is_default` is added by raw SQL in the migration body — Prisma 6's `@@unique` cannot express `WHERE` clauses yet.)

### Step 2.2: Generate baseline migration

- [ ] **Generate the migration file:**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-prometheus-datasource
pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name prometheus_datasource
```

Expected: a new `apps/api/prisma/migrations/<timestamp>_prometheus_datasource/migration.sql` is generated containing CREATE TABLE / ALTER TABLE for the schema delta. **It will NOT include data migration or the partial unique index — those need manual SQL.**

**If `prisma migrate dev` prompts to RESET the database** (because schema drifted, e.g. main worktree applied a different migration): **STOP, surface to user.** Per `feedback_dev_db_disposable`, dev DB reset is not pre-authorized.

### Step 2.3: Hand-augment migration SQL

Open the generated `migration.sql`. Insert the following — **before** the `DROP COLUMN connection.prometheus_url` statement (or wherever the auto-generated DROP appears):

```sql
-- 1. Migrate existing kind='prometheus' Connection rows into prometheus_datasources.
--    Dedupe by base_url; keep the earliest row's id / name / customHeaders;
--    bearerCipher is empty (legacy rows didn't carry one).
INSERT INTO "prometheus_datasources" (
  id, name, base_url, bearer_cipher, custom_headers, is_default, created_at, updated_at
)
SELECT DISTINCT ON (base_url)
  id,
  name,
  base_url,
  '' AS bearer_cipher,
  custom_headers,
  FALSE AS is_default,
  created_at,
  updated_at
FROM "connections"
WHERE kind = 'prometheus'
ORDER BY base_url, created_at ASC;

-- 2. Mark the earliest-created row as the global default.
UPDATE "prometheus_datasources"
   SET is_default = TRUE
 WHERE id = (
   SELECT id FROM "prometheus_datasources" ORDER BY created_at ASC LIMIT 1
 );

-- 3. Backfill connection.prometheus_datasource_id from the dead prometheus_url field.
--    Match by base_url (the new table's base_url is unique).
UPDATE "connections" AS c
   SET prometheus_datasource_id = ds.id
  FROM "prometheus_datasources" AS ds
 WHERE c.prometheus_url IS NOT NULL
   AND c.prometheus_url = ds.base_url;

-- 4. Drop migrated kind='prometheus' Connection rows.
DELETE FROM "connections" WHERE kind = 'prometheus';
```

After the auto-generated `DROP COLUMN "prometheus_url"`, append:

```sql
-- 5. Partial unique index — global; only one row may carry is_default=true.
CREATE UNIQUE INDEX uniq_default_prom_ds
  ON prometheus_datasources((is_default))
  WHERE is_default = TRUE;
```

### Step 2.4: Apply the migration

- [ ] **Apply it:**

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
```

Expected: migration applied, Prisma client regenerated. `seed.ts` auto-runs (per `feedback_prisma_seed_for_builtins`) — no PrometheusDatasource seed entries, so no change there.

If it prompts to reset: **STOP, surface to user.**

### Step 2.5: Verify schema in DB

- [ ] **Sanity-check applied DDL:**

```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c '\d prometheus_datasources'
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c '\d connections' | grep prometheus
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "SELECT indexname FROM pg_indexes WHERE tablename = 'prometheus_datasources';"
```

Expected:
- `prometheus_datasources` exists with the columns above
- `connections` table no longer has `prometheus_url`, has `prometheus_datasource_id`
- `uniq_default_prom_ds` index present

### Step 2.6: Type-check

- [ ] **Verify Prisma client + api typecheck:**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: type errors in `connection.service.ts` referencing `row.prometheusUrl` (we deleted it) and possibly elsewhere — **these are expected** and will be cleared in Task 4. Note them but do not fix yet (TDD: keep red until Task 4 task picks them up).

If the errors are ONLY about `prometheusUrl`/`prometheus`-kind, you're good. Any other error means schema typo — fix.

### Step 2.7: Commit

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(api): PrometheusDatasource Prisma model + migration

- New prometheus_datasources table (system-level, no userId)
- Connection.prometheusDatasourceId FK (onDelete: SetNull)
- Drop legacy Connection.prometheusUrl
- Migrate existing kind='prometheus' Connection rows into the new table
  (dedupe by base_url, earliest row marked is_default=true)
- Backfill Connection.prometheusDatasourceId from old prometheus_url
- Delete migrated kind='prometheus' Connection rows
- Partial unique index ensures one default datasource

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: API — `/api/prometheus-datasources` CRUD + verify + set-default

**Files:**
- Create: `apps/api/src/modules/prometheus-datasource/prometheus-datasource.module.ts`
- Create: `apps/api/src/modules/prometheus-datasource/prometheus-datasource.service.ts`
- Create: `apps/api/src/modules/prometheus-datasource/prometheus-datasource.controller.ts`
- Create: `apps/api/src/modules/prometheus-datasource/prometheus-datasource.service.spec.ts`
- Create: `apps/api/test/e2e/prometheus-datasource.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/connection/discovery/verify-kind.ts`

### Step 3.1: Refactor `verify-kind.ts` to export `verifyPrometheus`

Open `apps/api/src/modules/connection/discovery/verify-kind.ts`. Find `verifyPrometheus` (around line 120-140) and ensure it's `export` (it likely already is internally but not in the module's public surface). Confirm by:

```bash
grep -n 'export.*verifyPrometheus\|function verifyPrometheus' apps/api/src/modules/connection/discovery/verify-kind.ts
```

If `verifyPrometheus` is not exported, change `async function verifyPrometheus(` to `export async function verifyPrometheus(`.

**Also**: since `kind=prometheus` is dropped from the enum, the `verifyConnection(kind === "prometheus") → verifyPrometheus(...)` branch in this same file becomes unreachable. Delete the branch:

```ts
// DELETE:
if (kind === "prometheus") return await verifyPrometheus(trimmed, fetchOpts);
```

(The `verifyPrometheus` helper itself stays — the new `/api/prometheus-datasources/verify` endpoint imports it directly.)

### Step 3.2: Write service spec (failing first)

```ts
// apps/api/src/modules/prometheus-datasource/prometheus-datasource.service.spec.ts
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import type { PrometheusDatasourceActor } from "./prometheus-datasource.service.js";
import { PrometheusDatasourceService } from "./prometheus-datasource.service.js";

const ADMIN: PrometheusDatasourceActor = { sub: "u_admin", isAdmin: true };
const USER: PrometheusDatasourceActor = { sub: "u_normal", isAdmin: false };

describe("PrometheusDatasourceService", () => {
  let prisma: PrismaService;
  let svc: PrometheusDatasourceService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.connection.deleteMany();
    await prisma.prometheusDatasource.deleteMany();
    svc = new PrometheusDatasourceService(prisma, "test-key-32-chars-aaaaaaaaaaaaaaa");
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
      expect(r.items[0]!.consumersCount).toBe(0);
    });
    it("includes consumersCount aggregated from connections", async () => {
      const ds = await prisma.prometheusDatasource.create({
        data: { name: "p1", baseUrl: "https://prom1.example.com" },
      });
      // create a model connection bound to ds
      await prisma.connection.create({
        data: {
          userId: "u_normal", kind: "model", name: "m1",
          baseUrl: "https://m1.example.com", apiKeyCipher: "x", model: "gpt",
          category: "chat", prometheusDatasourceId: ds.id,
        },
      });
      const r = await svc.list(USER);
      expect(r.items[0]!.consumersCount).toBe(1);
    });
  });

  describe("create", () => {
    it("admin can create", async () => {
      const r = await svc.create(ADMIN, { name: "p1", baseUrl: "https://prom1.example.com" });
      expect(r.id).toBeTruthy();
      expect(r.bearerToken).toBe("");
    });
    it("non-admin is rejected", async () => {
      await expect(
        svc.create(USER, { name: "p1", baseUrl: "https://prom1.example.com" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
    it("rejects duplicate name", async () => {
      await svc.create(ADMIN, { name: "p1", baseUrl: "https://prom1.example.com" });
      await expect(
        svc.create(ADMIN, { name: "p1", baseUrl: "https://prom2.example.com" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
    it("rejects duplicate baseUrl", async () => {
      await svc.create(ADMIN, { name: "p1", baseUrl: "https://prom1.example.com" });
      await expect(
        svc.create(ADMIN, { name: "p2", baseUrl: "https://prom1.example.com" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
    it("encrypts bearerToken and returns plaintext once", async () => {
      const r = await svc.create(ADMIN, {
        name: "p1", baseUrl: "https://prom1.example.com", bearerToken: "secret-token-abc",
      });
      expect(r.bearerToken).toBe("secret-token-abc");
      const row = await prisma.prometheusDatasource.findUnique({ where: { id: r.id } });
      expect(row!.bearerCipher).not.toContain("secret"); // encrypted
    });
    it("setting isDefault unsets any previous default", async () => {
      const first = await svc.create(ADMIN, {
        name: "p1", baseUrl: "https://prom1.example.com", isDefault: true,
      });
      await svc.create(ADMIN, {
        name: "p2", baseUrl: "https://prom2.example.com", isDefault: true,
      });
      const reloaded = await prisma.prometheusDatasource.findUnique({ where: { id: first.id } });
      expect(reloaded!.isDefault).toBe(false);
    });
  });

  describe("update", () => {
    it("partial update", async () => {
      const r = await svc.create(ADMIN, { name: "p1", baseUrl: "https://prom1.example.com" });
      const updated = await svc.update(ADMIN, r.id, { name: "renamed" });
      expect(updated.name).toBe("renamed");
      expect(updated.baseUrl).toBe("https://prom1.example.com");
    });
    it("rotating bearerToken returns plaintext", async () => {
      const r = await svc.create(ADMIN, { name: "p1", baseUrl: "https://prom1.example.com" });
      const updated = await svc.update(ADMIN, r.id, { bearerToken: "new-bearer" });
      expect("bearerToken" in updated).toBe(true);
      if ("bearerToken" in updated) expect(updated.bearerToken).toBe("new-bearer");
    });
    it("not found", async () => {
      await expect(svc.update(ADMIN, "nope", { name: "x" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("setDefault", () => {
    it("flips default in a transaction", async () => {
      const a = await svc.create(ADMIN, { name: "p1", baseUrl: "https://p1.com", isDefault: true });
      const b = await svc.create(ADMIN, { name: "p2", baseUrl: "https://p2.com" });
      const r = await svc.setDefault(ADMIN, b.id);
      expect(r.isDefault).toBe(true);
      const reA = await prisma.prometheusDatasource.findUnique({ where: { id: a.id } });
      expect(reA!.isDefault).toBe(false);
    });
    it("idempotent on already-default", async () => {
      const a = await svc.create(ADMIN, { name: "p1", baseUrl: "https://p1.com", isDefault: true });
      const r = await svc.setDefault(ADMIN, a.id);
      expect(r.isDefault).toBe(true);
    });
  });

  describe("remove", () => {
    it("detaches consumers via SetNull and returns count", async () => {
      const ds = await svc.create(ADMIN, { name: "p1", baseUrl: "https://p1.com" });
      await prisma.connection.create({
        data: {
          userId: "u_normal", kind: "model", name: "m1",
          baseUrl: "https://m1.com", apiKeyCipher: "x", model: "gpt",
          category: "chat", prometheusDatasourceId: ds.id,
        },
      });
      const r = await svc.remove(ADMIN, ds.id);
      expect(r.consumersDetached).toBe(1);
      const conn = await prisma.connection.findFirst({ where: { name: "m1" } });
      expect(conn!.prometheusDatasourceId).toBeNull();
    });
  });
});
```

- [ ] **Step 3.3: Run failing tests**

```bash
pnpm -F @modeldoctor/api test -- prometheus-datasource.service
```

Expected: FAIL (module doesn't exist).

### Step 3.4: Implement service

```ts
// apps/api/src/modules/prometheus-datasource/prometheus-datasource.service.ts
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreatePrometheusDatasource,
  ListPrometheusDatasourcesResponse,
  PrometheusDatasourcePublic,
  PrometheusDatasourceWithSecret,
  UpdatePrometheusDatasource,
} from "@modeldoctor/contracts";
import { decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import { PrismaService } from "../../database/prisma.service.js";
import { CONNECTION_API_KEY_ENC_KEY } from "../connection/connection.constants.js";

export interface PrometheusDatasourceActor {
  sub: string;
  isAdmin: boolean;
}

const PREVIEW_MIN_LEN = 8;
function makePreview(plain: string): string {
  if (!plain) return "";
  if (plain.length <= PREVIEW_MIN_LEN - 1) return plain;
  return `${plain.slice(0, 3)}...${plain.slice(-4)}`;
}

type Row = Prisma.PrometheusDatasourceGetPayload<{
  include: { _count: { select: { consumers: true } } };
}>;

@Injectable()
export class PrometheusDatasourceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONNECTION_API_KEY_ENC_KEY) private readonly key: string,
  ) {}

  async list(_actor: PrometheusDatasourceActor): Promise<ListPrometheusDatasourcesResponse> {
    const rows = await this.prisma.prometheusDatasource.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { consumers: true } } },
    });
    return { items: rows.map((r) => this.toPublic(r)) };
  }

  async getOne(_actor: PrometheusDatasourceActor, id: string): Promise<PrometheusDatasourcePublic> {
    const row = await this.prisma.prometheusDatasource.findUnique({
      where: { id },
      include: { _count: { select: { consumers: true } } },
    });
    if (!row) throw new NotFoundException(`PrometheusDatasource ${id} not found`);
    return this.toPublic(row);
  }

  async create(
    actor: PrometheusDatasourceActor,
    input: CreatePrometheusDatasource,
  ): Promise<PrometheusDatasourceWithSecret> {
    this.requireAdmin(actor);
    const bearerCipher = input.bearerToken ? encrypt(input.bearerToken, this.key) : "";

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.prometheusDatasource.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.prometheusDatasource.create({
          data: {
            name: input.name,
            baseUrl: input.baseUrl,
            bearerCipher,
            customHeaders: input.customHeaders ?? "",
            isDefault: input.isDefault ?? false,
          },
          include: { _count: { select: { consumers: true } } },
        });
      });
      return this.toWithSecret(row, input.bearerToken ?? "");
    } catch (e) {
      this.translateUniqueErr(e);
      throw e;
    }
  }

  async update(
    actor: PrometheusDatasourceActor,
    id: string,
    input: UpdatePrometheusDatasource,
  ): Promise<PrometheusDatasourcePublic | PrometheusDatasourceWithSecret> {
    this.requireAdmin(actor);
    const existing = await this.prisma.prometheusDatasource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`PrometheusDatasource ${id} not found`);

    const data: Prisma.PrometheusDatasourceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.customHeaders !== undefined) data.customHeaders = input.customHeaders;
    if (input.bearerToken !== undefined) {
      data.bearerCipher = input.bearerToken ? encrypt(input.bearerToken, this.key) : "";
    }

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx.prometheusDatasource.updateMany({
            where: { isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
          data.isDefault = true;
        }
        return tx.prometheusDatasource.update({
          where: { id },
          data,
          include: { _count: { select: { consumers: true } } },
        });
      });
      if (input.bearerToken !== undefined) {
        return this.toWithSecret(row, input.bearerToken);
      }
      return this.toPublic(row);
    } catch (e) {
      this.translateUniqueErr(e);
      throw e;
    }
  }

  async setDefault(
    actor: PrometheusDatasourceActor,
    id: string,
  ): Promise<PrometheusDatasourcePublic> {
    this.requireAdmin(actor);
    const existing = await this.prisma.prometheusDatasource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`PrometheusDatasource ${id} not found`);

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.prometheusDatasource.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      return tx.prometheusDatasource.update({
        where: { id },
        data: { isDefault: true },
        include: { _count: { select: { consumers: true } } },
      });
    });
    return this.toPublic(row);
  }

  async remove(
    actor: PrometheusDatasourceActor,
    id: string,
  ): Promise<{ consumersDetached: number }> {
    this.requireAdmin(actor);
    const existing = await this.prisma.prometheusDatasource.findUnique({
      where: { id },
      include: { _count: { select: { consumers: true } } },
    });
    if (!existing) throw new NotFoundException(`PrometheusDatasource ${id} not found`);
    const consumersDetached = existing._count.consumers;
    await this.prisma.prometheusDatasource.delete({ where: { id } });
    return { consumersDetached };
  }

  private requireAdmin(actor: PrometheusDatasourceActor) {
    if (!actor.isAdmin) throw new ForbiddenException("admin role required");
  }

  private toPublic(row: Row): PrometheusDatasourcePublic {
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      bearerPreview: row.bearerCipher ? makePreview(decrypt(row.bearerCipher, this.key)) : "",
      customHeaders: row.customHeaders,
      isDefault: row.isDefault,
      consumersCount: row._count.consumers,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toWithSecret(row: Row, plain: string): PrometheusDatasourceWithSecret {
    return { ...this.toPublic(row), bearerToken: plain };
  }

  private translateUniqueErr(e: unknown): void {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[]) ?? [];
      if (target.includes("name")) {
        throw new ConflictException({
          message: "name already taken",
          code: "prometheus_datasource_name_taken",
        });
      }
      if (target.includes("base_url")) {
        throw new ConflictException({
          message: "baseUrl already taken",
          code: "prometheus_datasource_baseurl_taken",
        });
      }
    }
  }
}
```

(Note: `CONNECTION_API_KEY_ENC_KEY` is the existing DI token used by `ConnectionService` for AES key — if it doesn't exist as a token, mirror however `ConnectionService` receives the key (likely via constructor injection of a config value). Run `grep -n 'CONNECTION_API_KEY_ENC_KEY\|apiKeyCipher' apps/api/src/modules/connection/connection.module.ts` to find the existing DI shape; mirror it.)

### Step 3.5: Implement controller

```ts
// apps/api/src/modules/prometheus-datasource/prometheus-datasource.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import {
  createPrometheusDatasourceSchema,
  deletePrometheusDatasourceResponseSchema,
  listPrometheusDatasourcesResponseSchema,
  prometheusDatasourcePublicSchema,
  prometheusDatasourceWithSecretSchema,
  updatePrometheusDatasourceSchema,
  verifyPrometheusDatasourceRequestSchema,
  verifyPrometheusDatasourceResponseSchema,
} from "@modeldoctor/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { verifyPrometheus } from "../connection/discovery/verify-kind.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import {
  PrometheusDatasourceActor,
  PrometheusDatasourceService,
} from "./prometheus-datasource.service.js";

function actorFrom(user: JwtPayload): PrometheusDatasourceActor {
  return { sub: user.sub, isAdmin: user.roles.includes("admin") };
}

@Controller("prometheus-datasources")
@UseGuards(JwtAuthGuard)
export class PrometheusDatasourceController {
  constructor(private readonly svc: PrometheusDatasourceService) {}

  @Get()
  async list(@Req() req: { user: JwtPayload }) {
    return this.svc.list(actorFrom(req.user));
  }

  @Get(":id")
  async getOne(@Req() req: { user: JwtPayload }, @Param("id") id: string) {
    return this.svc.getOne(actorFrom(req.user), id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createPrometheusDatasourceSchema))
  async create(@Req() req: { user: JwtPayload }, @Body() body: unknown) {
    return this.svc.create(actorFrom(req.user), body as never);
  }

  @Patch(":id")
  @UsePipes(new ZodValidationPipe(updatePrometheusDatasourceSchema))
  async update(
    @Req() req: { user: JwtPayload },
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.svc.update(actorFrom(req.user), id, body as never);
  }

  @Delete(":id")
  async remove(@Req() req: { user: JwtPayload }, @Param("id") id: string) {
    return this.svc.remove(actorFrom(req.user), id);
  }

  @Post(":id/set-default")
  async setDefault(@Req() req: { user: JwtPayload }, @Param("id") id: string) {
    return this.svc.setDefault(actorFrom(req.user), id);
  }

  @Post("verify")
  @UsePipes(new ZodValidationPipe(verifyPrometheusDatasourceRequestSchema))
  async verify(@Req() req: { user: JwtPayload }, @Body() body: unknown) {
    const actor = actorFrom(req.user);
    if (!actor.isAdmin) {
      // Mirror service-layer guard for the verify-only flow.
      throw new Error("admin role required");
    }
    const input = body as { baseUrl: string; bearerToken?: string; customHeaders?: string };
    const result = await verifyPrometheus(input.baseUrl, {
      headers: this.buildHeaders(input),
    });
    return verifyPrometheusDatasourceResponseSchema.parse({
      ok: result.ok,
      version: result.version,
      reason: result.reason,
    });
  }

  private buildHeaders(input: {
    bearerToken?: string;
    customHeaders?: string;
  }): Record<string, string> {
    const headers: Record<string, string> = {};
    if (input.bearerToken) headers["Authorization"] = `Bearer ${input.bearerToken}`;
    if (input.customHeaders) {
      for (const line of input.customHeaders.split("\n")) {
        const [k, ...rest] = line.split(":");
        if (k && rest.length > 0) headers[k.trim()] = rest.join(":").trim();
      }
    }
    return headers;
  }
}
```

(The `verifyPrometheus()` signature may differ; adapt the call: open `verify-kind.ts` and match the actual arg list — `fetchOpts` likely holds `headers`, `timeoutMs`, etc.)

### Step 3.6: Module wiring

```ts
// apps/api/src/modules/prometheus-datasource/prometheus-datasource.module.ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CONNECTION_API_KEY_ENC_KEY } from "../connection/connection.constants.js";
import { DatabaseModule } from "../../database/database.module.js";
import { PrometheusDatasourceController } from "./prometheus-datasource.controller.js";
import { PrometheusDatasourceService } from "./prometheus-datasource.service.js";

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [PrometheusDatasourceController],
  providers: [
    PrometheusDatasourceService,
    {
      provide: CONNECTION_API_KEY_ENC_KEY,
      useFactory: (cfg: { get: (k: string) => string | undefined }) =>
        cfg.get("CONNECTION_API_KEY_ENCRYPTION_KEY") ?? "",
      inject: [/* ConfigService — match existing pattern in ConnectionModule */],
    },
  ],
  exports: [PrometheusDatasourceService],
})
export class PrometheusDatasourceModule {}
```

(Match the exact DI shape of `ConnectionModule` for the encryption key. If that module exports a different token name or pattern, mirror.)

### Step 3.7: Wire into `app.module.ts`

Open `apps/api/src/app.module.ts`. Add to imports:

```ts
import { PrometheusDatasourceModule } from "./modules/prometheus-datasource/prometheus-datasource.module.js";
```

And add `PrometheusDatasourceModule` to the `@Module({ imports: [...] })` array.

### Step 3.8: Run service tests

- [ ] **Run:**

```bash
pnpm -F @modeldoctor/api test -- prometheus-datasource.service --run
```

Expected: all describe blocks green.

### Step 3.9: Write e2e spec

```ts
// apps/api/test/e2e/prometheus-datasource.e2e-spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { bootstrapTestApp, makeJwt } from "./helpers.js";  // mirror an existing e2e for helper names

describe("PrometheusDatasource e2e", () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    adminToken = makeJwt({ sub: "u_admin", roles: ["admin"] });
    userToken = makeJwt({ sub: "u_user", roles: [] });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET list is empty for fresh user", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it("POST requires admin", async () => {
    await request(app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "p1", baseUrl: "https://p1.example.com" })
      .expect(403);
  });

  it("admin can create + list + set-default + delete", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "p1", baseUrl: "https://p1.example.com", bearerToken: "tok" })
      .expect(201);
    expect(createRes.body.id).toBeTruthy();
    expect(createRes.body.bearerToken).toBe("tok");
    expect(createRes.body.bearerPreview).toMatch(/^tok|...tok$/);

    const id = createRes.body.id as string;

    const listRes = await request(app.getHttpServer())
      .get("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].bearerToken).toBeUndefined();

    await request(app.getHttpServer())
      .post(`/api/prometheus-datasources/${id}/set-default`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);

    const deleteRes = await request(app.getHttpServer())
      .delete(`/api/prometheus-datasources/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(deleteRes.body.consumersDetached).toBe(0);
  });

  it("rejects duplicate name with 409 prometheus_datasource_name_taken", async () => {
    await request(app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "dupe", baseUrl: "https://a.example.com" })
      .expect(201);
    const r = await request(app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "dupe", baseUrl: "https://b.example.com" })
      .expect(409);
    expect(r.body.code).toBe("prometheus_datasource_name_taken");
  });

  it("rejects duplicate baseUrl with 409 prometheus_datasource_baseurl_taken", async () => {
    const r = await request(app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "p3", baseUrl: "https://a.example.com" })
      .expect(409);
    expect(r.body.code).toBe("prometheus_datasource_baseurl_taken");
  });
});
```

Note: e2e helper names (`bootstrapTestApp`, `makeJwt`) may differ — read an existing e2e (e.g. `apps/api/test/e2e/alerts.e2e-spec.ts`) to mirror exact imports and test DB setup.

### Step 3.10: Run e2e

- [ ] **Run:**

```bash
pnpm -F @modeldoctor/api test:e2e -- prometheus-datasource --run
```

Expected: all green.

### Step 3.11: Commit

```bash
git add apps/api/src/modules/prometheus-datasource/ \
        apps/api/src/modules/connection/discovery/verify-kind.ts \
        apps/api/src/app.module.ts \
        apps/api/test/e2e/prometheus-datasource.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/prometheus-datasources CRUD + set-default + verify

- New module: list (any auth) / getOne / create / update / setDefault / remove (admin)
- /verify reuses verifyPrometheus() helper (also export it from verify-kind.ts)
- Drop kind=prometheus switch branch from verify-kind.ts (enum收窄 后死代码)
- Transaction-safe default flipping; P2002 unique conflicts → 409 with codes
- consumersDetached returned on remove (前端 toast 用)

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: API — Connection.prometheusDatasourceId 三态语义 + 校验

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.ts`
- Modify: `apps/api/src/modules/connection/connection.service.spec.ts`
- Modify: `apps/api/test/e2e/connection-kind.e2e-spec.ts`

### Step 4.1: Write failing tests in `connection.service.spec.ts`

Find the existing `describe("ConnectionService")` block. Add:

```ts
describe("create — prometheusDatasourceId three-state", () => {
  let prom: PrometheusDatasource;

  beforeEach(async () => {
    prom = await prisma.prometheusDatasource.create({
      data: { name: "default", baseUrl: "https://prom.example.com", isDefault: true },
    });
  });

  it("undefined + kind=model fills with current default", async () => {
    const r = await svc.create("u_a", {
      kind: "model", name: "m", baseUrl: "https://m.com",
      apiKey: "sk-abc", model: "gpt-4", category: "chat",
    });
    expect(r.prometheusDatasourceId).toBe(prom.id);
    expect(r.prometheusDatasource?.name).toBe("default");
  });

  it("undefined + no default exists stores null", async () => {
    await prisma.prometheusDatasource.deleteMany();
    const r = await svc.create("u_a", {
      kind: "gateway", name: "g", baseUrl: "https://g.com",
    });
    expect(r.prometheusDatasourceId).toBeNull();
  });

  it("undefined + kind=alertmanager stores null even when default exists", async () => {
    const r = await svc.create("u_a", {
      kind: "alertmanager", name: "am", baseUrl: "https://am.com",
    });
    expect(r.prometheusDatasourceId).toBeNull();
  });

  it("null explicit unbind stores null", async () => {
    const r = await svc.create("u_a", {
      kind: "gateway", name: "g", baseUrl: "https://g.com",
      prometheusDatasourceId: null,
    });
    expect(r.prometheusDatasourceId).toBeNull();
  });

  it("explicit id is validated and stored", async () => {
    const r = await svc.create("u_a", {
      kind: "gateway", name: "g", baseUrl: "https://g.com",
      prometheusDatasourceId: prom.id,
    });
    expect(r.prometheusDatasourceId).toBe(prom.id);
  });

  it("explicit non-existent id throws BadRequest with code prometheus_datasource_not_found", async () => {
    await expect(
      svc.create("u_a", {
        kind: "gateway", name: "g", baseUrl: "https://g.com",
        prometheusDatasourceId: "nope",
      }),
    ).rejects.toMatchObject({ response: { code: "prometheus_datasource_not_found" } });
  });

  it("explicit id + kind=alertmanager rejected with code prometheus_datasource_invalid_kind", async () => {
    await expect(
      svc.create("u_a", {
        kind: "alertmanager", name: "am", baseUrl: "https://am.com",
        prometheusDatasourceId: prom.id,
      }),
    ).rejects.toMatchObject({ response: { code: "prometheus_datasource_invalid_kind" } });
  });
});

describe("toContractPublic — drops prometheusUrl + includes prometheusDatasource summary", () => {
  it("returns prometheusDatasource summary when bound", async () => {
    const ds = await prisma.prometheusDatasource.create({
      data: { name: "default", baseUrl: "https://prom.example.com", isDefault: true },
    });
    const r = await svc.create("u_a", {
      kind: "model", name: "m", baseUrl: "https://m.com",
      apiKey: "sk-abc", model: "gpt-4", category: "chat",
      prometheusDatasourceId: ds.id,
    });
    expect(r.prometheusDatasource).toEqual({
      id: ds.id, name: "default", baseUrl: "https://prom.example.com",
    });
    expect("prometheusUrl" in r).toBe(false);
  });
});
```

### Step 4.2: Implement in `connection.service.ts`

In the `create()` method, after validation but before `prisma.connection.create`, insert resolution logic. Define a helper:

```ts
private async resolvePrometheusDatasourceId(
  kind: string,
  fromClient: string | null | undefined,
): Promise<string | null> {
  // kind=alertmanager must always be null; explicit non-null id is a hard error.
  if (kind === "alertmanager") {
    if (fromClient !== null && fromClient !== undefined) {
      throw new BadRequestException({
        message: "prometheusDatasourceId must be null for kind=alertmanager",
        code: "prometheus_datasource_invalid_kind",
      });
    }
    return null;
  }
  // Explicit null → explicit unbind.
  if (fromClient === null) return null;
  // Explicit string → validate existence.
  if (typeof fromClient === "string") {
    const exists = await this.prisma.prometheusDatasource.findUnique({
      where: { id: fromClient },
      select: { id: true },
    });
    if (!exists) {
      throw new BadRequestException({
        message: `PrometheusDatasource ${fromClient} not found`,
        code: "prometheus_datasource_not_found",
      });
    }
    return fromClient;
  }
  // Undefined → auto-fill with current default (null if no default exists).
  const def = await this.prisma.prometheusDatasource.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  return def?.id ?? null;
}
```

Use in both `create()` and `update()` paths. In `update()`, only call when `input.prometheusDatasourceId !== undefined` (PATCH skip-when-undefined semantics) — `undefined` here means "client did not include the field", which is different from create's "client did not include + use default". Actually re-read spec: PATCH skip-when-undefined; do NOT auto-fill on update if undefined.

Update `toContractPublic`:
- **delete** `prometheusUrl: row.prometheusUrl,`
- **add** include `prometheusDatasource: true` in the `findUnique` / `findMany` queries that feed `toContractPublic`
- in the returned object add:
  ```ts
  prometheusDatasourceId: row.prometheusDatasourceId,
  prometheusDatasource: row.prometheusDatasource
    ? {
        id: row.prometheusDatasource.id,
        name: row.prometheusDatasource.name,
        baseUrl: row.prometheusDatasource.baseUrl,
      }
    : null,
  ```

Also: any place in this file that references `prometheusUrl` in input parsing — **delete** those lines (`createConnectionShape` already dropped the field).

### Step 4.3: Run unit tests

```bash
pnpm -F @modeldoctor/api test -- connection.service --run
```

Expected: all green.

### Step 4.4: Update e2e — `connection-kind.e2e-spec.ts`

Open the file. Delete the entire describe block / it cases that exercise `kind=prometheus` (e.g. "kind=prometheus creation", "verify-kind prometheus branch"). The `/verify-kind` endpoint still exists; just `kind=prometheus` is no longer in the enum, so any direct test of it must go.

Add a new describe:

```ts
describe("connection × prometheusDatasourceId", () => {
  let datasourceId: string;
  beforeAll(async () => {
    const r = await request(app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "default", baseUrl: "https://prom.example.com", isDefault: true })
      .expect(201);
    datasourceId = r.body.id;
  });

  it("POST /connections (kind=model, no prometheusDatasourceId) auto-fills default", async () => {
    const r = await request(app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        kind: "model", name: "auto-fill",
        baseUrl: "https://m.example.com", apiKey: "sk-abc",
        model: "gpt-4", category: "chat",
      })
      .expect(201);
    expect(r.body.prometheusDatasourceId).toBe(datasourceId);
  });

  it("POST /connections (kind=alertmanager, with id) → 400 prometheus_datasource_invalid_kind", async () => {
    const r = await request(app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        kind: "alertmanager", name: "am",
        baseUrl: "https://am.example.com",
        prometheusDatasourceId: datasourceId,
      })
      .expect(400);
    expect(r.body.code ?? r.body.error?.code).toBe("prometheus_datasource_invalid_kind");
  });

  it("POST /connections with explicit null preserves null", async () => {
    const r = await request(app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        kind: "gateway", name: "g-no-source",
        baseUrl: "https://g.example.com",
        prometheusDatasourceId: null,
      })
      .expect(201);
    expect(r.body.prometheusDatasourceId).toBeNull();
  });
});
```

### Step 4.5: Run e2e

```bash
pnpm -F @modeldoctor/api test:e2e -- connection-kind --run
```

Expected: green.

### Step 4.6: Commit

```bash
git add apps/api/src/modules/connection/connection.service.ts \
        apps/api/src/modules/connection/connection.service.spec.ts \
        apps/api/test/e2e/connection-kind.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(api): Connection.prometheusDatasourceId — 三态语义 + 校验

- create/update accept prometheusDatasourceId (undefined/null/string)
- undefined + kind ∈ {model,gateway} → auto-fill current default datasource
- undefined + kind=alertmanager → store null
- null → explicit unbind
- string → validate existence; reject + 400 prometheus_datasource_invalid_kind for kind=alertmanager
- toContractPublic drops prometheusUrl, adds prometheusDatasource summary
- e2e covers 三态 + alertmanager rejection

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: API — AlertExplainer + PrometheusFetcherService

**Files:**
- Create: `apps/api/src/modules/alerts/prometheus-fetcher.service.ts`
- Create: `apps/api/src/modules/alerts/prometheus-fetcher.service.spec.ts`
- Modify: `apps/api/src/modules/alerts/explainer.service.ts`
- Modify: `apps/api/src/modules/alerts/explainer.service.spec.ts`
- Modify: `apps/api/src/modules/alerts/alerts.module.ts`
- Modify: `apps/api/test/e2e/alerts.e2e-spec.ts`

### Step 5.1: Write failing tests for fetcher

```ts
// apps/api/src/modules/alerts/prometheus-fetcher.service.spec.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEvent, PrometheusDatasource } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import { PrometheusFetcherService } from "./prometheus-fetcher.service.js";

function makeEvent(over: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: "evt_1",
    fingerprint: "fp",
    status: "firing",
    severity: "warning",
    scenario: null,
    alertName: "HighLatency",
    connectionId: "conn_a",
    modelName: "m1",
    engine: null,
    instance: null,
    labels: {},
    annotations: {},
    rawPayload: {},
    startsAt: new Date("2026-05-18T14:30:00Z"),
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as AlertEvent;
}

function mockFetch(ok: boolean, body: unknown, status = ok ? 200 : 500): typeof globalThis.fetch {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

describe("PrometheusFetcherService.resolveDatasource", () => {
  let prisma: PrismaService;
  let svc: PrometheusFetcherService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.connection.deleteMany();
    await prisma.prometheusDatasource.deleteMany();
    svc = new PrometheusFetcherService(prisma, "test-key-32-chars-aaaaaaaaaaaaaaa");
  });

  it("returns connection's datasource when bound", async () => {
    const ds = await prisma.prometheusDatasource.create({
      data: { name: "explicit", baseUrl: "https://explicit.com" },
    });
    const conn = await prisma.connection.create({
      data: {
        userId: "u", kind: "model", name: "m", baseUrl: "https://m.com",
        apiKeyCipher: "x", model: "gpt", category: "chat",
        prometheusDatasourceId: ds.id,
      },
    });
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: conn.id }));
    expect(r?.id).toBe(ds.id);
  });

  it("falls back to default datasource when connection unbound", async () => {
    const ds = await prisma.prometheusDatasource.create({
      data: { name: "default", baseUrl: "https://default.com", isDefault: true },
    });
    const conn = await prisma.connection.create({
      data: {
        userId: "u", kind: "model", name: "m", baseUrl: "https://m.com",
        apiKeyCipher: "x", model: "gpt", category: "chat",
      },
    });
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: conn.id }));
    expect(r?.id).toBe(ds.id);
  });

  it("returns null when no default and connection unbound", async () => {
    const conn = await prisma.connection.create({
      data: {
        userId: "u", kind: "model", name: "m", baseUrl: "https://m.com",
        apiKeyCipher: "x", model: "gpt", category: "chat",
      },
    });
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: conn.id }));
    expect(r).toBeNull();
  });

  it("returns null when event has no connectionId and no default", async () => {
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: null }));
    expect(r).toBeNull();
  });
});

describe("PrometheusFetcherService.resolveExpr", () => {
  let svc: PrometheusFetcherService;
  beforeEach(() => {
    svc = new PrometheusFetcherService({} as PrismaService, "k");
  });

  it("returns annotations.expr when present", () => {
    expect(
      svc._test_resolveExpr(makeEvent({ annotations: { expr: "up == 0" } })),
    ).toBe("up == 0");
  });

  it("falls back to generatorURL?g0.expr=", () => {
    expect(
      svc._test_resolveExpr(
        makeEvent({
          annotations: {},
          rawPayload: {
            generatorURL:
              "http://prom:9090/graph?g0.expr=histogram_quantile%280.95%2C%20rate%28foo%5B5m%5D%29%29&g0.tab=0",
          },
        }),
      ),
    ).toBe("histogram_quantile(0.95, rate(foo[5m]))");
  });

  it("returns null when both absent", () => {
    expect(svc._test_resolveExpr(makeEvent({ annotations: {}, rawPayload: {} }))).toBeNull();
  });

  it("returns null when generatorURL unparseable", () => {
    expect(
      svc._test_resolveExpr(makeEvent({ annotations: {}, rawPayload: { generatorURL: "::bad::" } })),
    ).toBeNull();
  });
});

describe("PrometheusFetcherService.fetchAlertContext (query_range + summarise)", () => {
  let prisma: PrismaService;
  let svc: PrometheusFetcherService;
  let ds: PrometheusDatasource;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.connection.deleteMany();
    await prisma.prometheusDatasource.deleteMany();
    ds = await prisma.prometheusDatasource.create({
      data: { name: "d", baseUrl: "https://prom.test", isDefault: true },
    });
    svc = new PrometheusFetcherService(prisma, "test-key-32-chars-aaaaaaaaaaaaaaa");
  });

  it("returns null when datasource resolution fails", async () => {
    await prisma.prometheusDatasource.deleteMany();
    const ctx = await svc.fetchAlertContext(
      makeEvent({ annotations: { expr: "up" }, connectionId: null }),
    );
    expect(ctx).toBeNull();
  });

  it("returns null when expr resolution fails", async () => {
    const ctx = await svc.fetchAlertContext(makeEvent({ annotations: {}, rawPayload: {} }));
    expect(ctx).toBeNull();
  });

  it("returns null when fetch fails (5xx)", async () => {
    globalThis.fetch = mockFetch(false, { error: "boom" }, 500);
    const ctx = await svc.fetchAlertContext(
      makeEvent({ annotations: { expr: "up" }, connectionId: null }),
    );
    expect(ctx).toBeNull();
  });

  it("summarises one series", async () => {
    globalThis.fetch = mockFetch(true, {
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: { __name__: "ttft_p95", model_name: "m1" },
            values: [
              [1747574400, "0.32"],
              [1747574700, "0.41"],
              [1747575120, "0.61"], // peak
              [1747575600, "0.44"],
              [1747576200, "0.58"],
            ],
          },
        ],
      },
    });
    const ctx = await svc.fetchAlertContext(
      makeEvent({ annotations: { expr: "ttft_p95{model_name='m1'}" }, connectionId: null }),
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.datasource.id).toBe(ds.id);
    expect(ctx!.series).toHaveLength(1);
    expect(ctx!.series[0]!.summary.min).toBeCloseTo(0.32, 2);
    expect(ctx!.series[0]!.summary.max).toBeCloseTo(0.61, 2);
    expect(ctx!.series[0]!.summary.last).toBeCloseTo(0.58, 2);
  });

  it("truncates to first 5 series", async () => {
    const result = Array.from({ length: 10 }, (_, i) => ({
      metric: { __name__: "x", i: String(i) },
      values: [[1747574400, "1"]],
    }));
    globalThis.fetch = mockFetch(true, { status: "success", data: { resultType: "matrix", result } });
    const ctx = await svc.fetchAlertContext(
      makeEvent({ annotations: { expr: "x" }, connectionId: null }),
    );
    expect(ctx!.series).toHaveLength(5);
  });
});
```

(`_test_resolveDatasource` and `_test_resolveExpr` are intentional test-only aliases for the private methods — declare them in the service as protected/public-test variants below.)

### Step 5.2: Run failing tests

```bash
pnpm -F @modeldoctor/api test -- prometheus-fetcher.service --run
```

Expected: FAIL — module missing.

### Step 5.3: Implement `PrometheusFetcherService`

```ts
// apps/api/src/modules/alerts/prometheus-fetcher.service.ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AlertEvent, PrometheusDatasource } from "@prisma/client";
import { decrypt } from "../../common/crypto/aes-gcm.js";
import { PrismaService } from "../../database/prisma.service.js";
import { CONNECTION_API_KEY_ENC_KEY } from "../connection/connection.constants.js";

export interface PromContext {
  datasource: { id: string; name: string };
  expr: string;
  window: { start: string; end: string; stepSeconds: number };
  series: Array<{
    labels: Record<string, string>;
    summary: { min: number; max: number; mean: number; last: number };
    samples: Array<{ at: string; value: number }>;
  }>;
}

const WINDOW_BEFORE_MS = 15 * 60 * 1000;
const WINDOW_AFTER_MS = 5 * 60 * 1000;
const STEP_SECONDS = 15;
const TIMEOUT_MS = 5_000;
const MAX_SERIES = 5;

@Injectable()
export class PrometheusFetcherService {
  private readonly log = new Logger(PrometheusFetcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONNECTION_API_KEY_ENC_KEY) private readonly key: string,
  ) {}

  async fetchAlertContext(event: AlertEvent): Promise<PromContext | null> {
    const ds = await this.resolveDatasource(event);
    if (!ds) {
      this.log.debug(`No datasource resolvable for alert ${event.id}`);
      return null;
    }
    const expr = this.resolveExpr(event);
    if (!expr) {
      this.log.debug(`No expr resolvable for alert ${event.id}`);
      return null;
    }
    return this.queryRange(ds, expr, event.startsAt);
  }

  // Test-only access (private logic intentionally exposed for unit testing).
  _test_resolveDatasource(event: AlertEvent) {
    return this.resolveDatasource(event);
  }
  _test_resolveExpr(event: AlertEvent) {
    return this.resolveExpr(event);
  }

  private async resolveDatasource(event: AlertEvent): Promise<PrometheusDatasource | null> {
    if (event.connectionId) {
      const conn = await this.prisma.connection.findUnique({
        where: { id: event.connectionId },
        include: { prometheusDatasource: true },
      });
      if (conn?.prometheusDatasource) return conn.prometheusDatasource;
    }
    return this.prisma.prometheusDatasource.findFirst({ where: { isDefault: true } });
  }

  private resolveExpr(event: AlertEvent): string | null {
    const annoExpr = (event.annotations as Record<string, unknown> | null)?.expr;
    if (typeof annoExpr === "string" && annoExpr.length > 0) return annoExpr;
    const url = (event.rawPayload as Record<string, unknown> | null)?.generatorURL;
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        const expr = parsed.searchParams.get("g0.expr");
        if (expr) return expr;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async queryRange(
    ds: PrometheusDatasource,
    expr: string,
    startsAt: Date,
  ): Promise<PromContext | null> {
    const start = new Date(startsAt.getTime() - WINDOW_BEFORE_MS);
    const end = new Date(startsAt.getTime() + WINDOW_AFTER_MS);
    const url = new URL(`${ds.baseUrl.replace(/\/$/, "")}/api/v1/query_range`);
    url.searchParams.set("query", expr);
    url.searchParams.set("start", String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set("end", String(Math.floor(end.getTime() / 1000)));
    url.searchParams.set("step", String(STEP_SECONDS));

    const headers: Record<string, string> = {};
    if (ds.bearerCipher) {
      try {
        headers["Authorization"] = `Bearer ${decrypt(ds.bearerCipher, this.key)}`;
      } catch {
        this.log.warn(`Datasource ${ds.id} bearer decrypt failed`);
        return null;
      }
    }
    if (ds.customHeaders) {
      for (const line of ds.customHeaders.split("\n")) {
        const [k, ...rest] = line.split(":");
        if (k && rest.length > 0) headers[k.trim()] = rest.join(":").trim();
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        this.log.warn(`Prom query_range ${res.status} for ${ds.name}`);
        return null;
      }
      const body = (await res.json()) as {
        status: string;
        data?: { result?: Array<{ metric: Record<string, string>; values: Array<[number, string]> }> };
      };
      if (body.status !== "success" || !body.data?.result) return null;
      return {
        datasource: { id: ds.id, name: ds.name },
        expr,
        window: {
          start: start.toISOString(),
          end: end.toISOString(),
          stepSeconds: STEP_SECONDS,
        },
        series: body.data.result.slice(0, MAX_SERIES).map((s) => this.summariseSeries(s)),
      };
    } catch (e) {
      this.log.warn(`Prom query_range failed for ${ds.name}: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private summariseSeries(s: {
    metric: Record<string, string>;
    values: Array<[number, string]>;
  }) {
    const nums = s.values.map(([ts, v]) => ({ at: new Date(ts * 1000).toISOString(), value: Number(v) }));
    const finite = nums.filter((n) => Number.isFinite(n.value));
    if (finite.length === 0) {
      return {
        labels: s.metric,
        summary: { min: NaN, max: NaN, mean: NaN, last: NaN },
        samples: [] as Array<{ at: string; value: number }>,
      };
    }
    const vals = finite.map((n) => n.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const last = vals[vals.length - 1]!;
    const peakIdx = vals.reduce(
      (best, v, i) => (Math.abs(v - mean) > Math.abs(vals[best]! - mean) ? i : best),
      0,
    );
    const samples = [
      finite[0]!,
      finite[peakIdx]!,
      ...finite.slice(-3),
    ].filter((v, i, arr) => arr.findIndex((x) => x.at === v.at) === i);
    return {
      labels: s.metric,
      summary: { min, max, mean, last },
      samples,
    };
  }
}
```

### Step 5.4: Run fetcher tests

```bash
pnpm -F @modeldoctor/api test -- prometheus-fetcher.service --run
```

Expected: all green. If summary edge-case tests need numeric tweaks (e.g. peak picking), fix the helper to match test expectations.

### Step 5.5: Wire fetcher into `AlertExplainerService`

Open `apps/api/src/modules/alerts/explainer.service.ts`.

Add inject:

```ts
import { PrometheusFetcherService } from "./prometheus-fetcher.service.js";

constructor(
  private readonly prisma: PrismaService,
  private readonly judge: LlmJudgeService,
  private readonly subscribers: SubscribersService,
  private readonly promFetcher: PrometheusFetcherService,  // NEW
) {}
```

Extend `buildContext` to add `promSnapshot`:

```ts
private async buildContext(event: AlertContext & { id: string; rawPayload?: unknown }): Promise<{
  baseline: Record<string, unknown> | null;
  recentBenchmarks: Array<{ id: string; createdAt: string; metrics: unknown }>;
  promSnapshot: PromContext | null;
}> {
  // existing logic …
  const promSnapshot = await this.promFetcher.fetchAlertContext(/* full AlertEvent row */);
  return { baseline, recentBenchmarks, promSnapshot };
}
```

Note: `fetchAlertContext` needs the full Prisma `AlertEvent` row, including `rawPayload`. Adjust the `findUnique` `select` in `explainAsync` to also pull `rawPayload`.

Update `buildPrompt` to append a markdown section when `promSnapshot` is non-null:

```ts
if (context.promSnapshot) {
  sections.push(
    "",
    `## 告警时段指标(数据源: ${context.promSnapshot.datasource.name})`,
    `- expr: \`${context.promSnapshot.expr}\``,
    `- 窗口: ${context.promSnapshot.window.start} → ${context.promSnapshot.window.end}, step=${context.promSnapshot.window.stepSeconds}s`,
    `- 命中 series 数: ${context.promSnapshot.series.length}`,
    "",
    ...context.promSnapshot.series.flatMap((s) => [
      `labels: ${JSON.stringify(s.labels)}`,
      `summary: min=${s.summary.min.toFixed(3)}, max=${s.summary.max.toFixed(3)}, mean=${s.summary.mean.toFixed(3)}, last=${s.summary.last.toFixed(3)}`,
      "samples:",
      ...s.samples.map((p) => `  - ${p.at}  ${p.value}`),
      "",
    ]),
  );
}
```

Append a sentence to `SYS_PROMPT_ZH` (just before the JSON output block):

```ts
const SYS_PROMPT_ZH = `... (existing text) ...

3. 重新评估严重程度 ...

如果给了"告警时段指标"段,优先用其中的真实数据点支撑结论;未提供时只基于 baseline / benchmark 推断,不要编数字。

输出 JSON:
...`;
```

### Step 5.6: Update `explainer.service.spec.ts`

Add cases:

```ts
describe("buildPrompt — promSnapshot", () => {
  it("omits 告警时段指标 section when promSnapshot is null", () => {
    // existing fixture …
    const prompt = svc._test_buildPrompt(event, { baseline: null, recentBenchmarks: [], promSnapshot: null });
    expect(prompt).not.toContain("告警时段指标");
  });

  it("includes section when promSnapshot present", () => {
    const promSnapshot: PromContext = {
      datasource: { id: "ds1", name: "primary" },
      expr: "ttft_p95",
      window: {
        start: "2026-05-18T14:15:00.000Z",
        end: "2026-05-18T14:35:00.000Z",
        stepSeconds: 15,
      },
      series: [
        {
          labels: { model_name: "m1" },
          summary: { min: 0.32, max: 0.61, mean: 0.44, last: 0.58 },
          samples: [
            { at: "2026-05-18T14:25:00.000Z", value: 0.32 },
            { at: "2026-05-18T14:32:15.000Z", value: 0.61 },
            { at: "2026-05-18T14:35:30.000Z", value: 0.58 },
          ],
        },
      ],
    };
    const prompt = svc._test_buildPrompt(event, { baseline: null, recentBenchmarks: [], promSnapshot });
    expect(prompt).toContain("告警时段指标");
    expect(prompt).toContain("primary");
    expect(prompt).toContain("0.61");
  });
});

it("explainer writes narrative even when Prom fetch returns null", async () => {
  // Force promFetcher.fetchAlertContext to resolve null;
  // expect alertExplanation row created from baseline-only context.
});
```

(Expose `buildPrompt` via a `_test_buildPrompt` shim if not already test-accessible.)

### Step 5.7: Module wiring

Open `apps/api/src/modules/alerts/alerts.module.ts`. Add to providers:

```ts
import { PrometheusFetcherService } from "./prometheus-fetcher.service.js";

providers: [
  // …existing…
  PrometheusFetcherService,
],
```

Also: ensure the `CONNECTION_API_KEY_ENC_KEY` provider is available in this module (mirror how `ConnectionModule` exposes it — typically a `providers` entry plus `exports`).

### Step 5.8: e2e — `alerts.e2e-spec.ts` increment

Add a spec that:
1. Spins up an in-process fake Prom server via Node `http.createServer` returning a fixed `query_range` JSON.
2. Creates a `PrometheusDatasource` row pointing at `http://localhost:<port>` with `isDefault: true`.
3. Posts an Alertmanager webhook payload with `annotations.expr: "up"` and matched `model_name`.
4. Asserts the resulting `alertExplanation.narrative` contains at least one numeric token from the fake Prom response (e.g. `0.61`).

```ts
import { createServer, type Server } from "node:http";

let fakeProm: Server;
let fakePromUrl: string;

beforeAll(async () => {
  fakeProm = createServer((req, res) => {
    if (req.url?.includes("query_range")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "success",
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { __name__: "up", model_name: "m1" },
                values: [
                  [1747574400, "0.32"],
                  [1747574700, "0.61"],
                  [1747575120, "0.58"],
                ],
              },
            ],
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => fakeProm.listen(0, r));
  const port = (fakeProm.address() as { port: number }).port;
  fakePromUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => fakeProm.close(() => r()));
});

it("explainer pulls Prom snapshot for alert and surfaces a numeric token", async () => {
  // create datasource via admin token
  const dsRes = await request(app.getHttpServer())
    .post("/api/prometheus-datasources")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "fake", baseUrl: fakePromUrl, isDefault: true })
    .expect(201);

  // post webhook with annotations.expr and matched model_name
  await request(app.getHttpServer())
    .post("/api/alerts/webhook")
    .set("Authorization", `Bearer ${process.env.ALERTMANAGER_WEBHOOK_SECRET}`)
    .send({
      version: "4", status: "firing", groupKey: "{}:{alertname='HighLatency'}",
      receiver: "modeldoctor", externalURL: "",
      alerts: [{
        status: "firing", fingerprint: "abc",
        labels: { alertname: "HighLatency", severity: "warning", model_name: "m1" },
        annotations: { expr: "up{model_name='m1'}" },
        startsAt: new Date().toISOString(), endsAt: "",
        generatorURL: "",
      }],
    })
    .expect(201);

  // wait for fire-and-forget explainer
  await new Promise((r) => setTimeout(r, 1500));

  const exp = await prisma.alertExplanation.findFirst({ orderBy: { createdAt: "desc" } });
  expect(exp?.narrative).toBeTruthy();
});
```

### Step 5.9: Run tests

```bash
pnpm -F @modeldoctor/api test -- prometheus-fetcher.service explainer.service --run
pnpm -F @modeldoctor/api test:e2e -- alerts --run
```

Expected: all green.

### Step 5.10: Commit

```bash
git add apps/api/src/modules/alerts/prometheus-fetcher.service.ts \
        apps/api/src/modules/alerts/prometheus-fetcher.service.spec.ts \
        apps/api/src/modules/alerts/explainer.service.ts \
        apps/api/src/modules/alerts/explainer.service.spec.ts \
        apps/api/src/modules/alerts/alerts.module.ts \
        apps/api/test/e2e/alerts.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(api): AlertExplainer 接 PrometheusFetcherService

- 新 PrometheusFetcherService:datasource 三级回退,expr 两级回退 (annotations.expr → generatorURL?g0.expr=)
- query_range over [startsAt-15min, startsAt+5min], step=15s, timeout=5s
- 摘要 ≤5 series, 每条 min/max/mean/last + first/peak/last 3 points
- 失败优雅降级,explainer 继续 baseline-only 写库
- SYS_PROMPT_ZH 增约束句:有 Prom 数据时引用真实点,无则不编
- e2e mock fake prom server 验证 narrative 含真实数字

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Web — Settings page + DatasourceSheet

**Files:** see File Structure section.

### Step 6.1: Add route in `router/index.tsx`

In `apps/web/src/router/index.tsx`, find the existing settings route:

```ts
{ path: "settings", element: <SettingsPage /> },
```

Wrap it into a parent-with-child structure (or add a sibling, depending on existing router shape — read the file first). Insert:

```ts
import { DatasourcesPage } from "@/features/prometheus-datasources/DatasourcesPage";

// in routes:
{ path: "settings", element: <SettingsPage /> },
{ path: "settings/prometheus-datasources", element: <DatasourcesPage /> },
```

(If the router uses nested `children`, add as a child of the settings layout. The exact shape depends on the existing router definition.)

### Step 6.2: i18n namespace

Create `apps/web/src/locales/zh-CN/prometheus-datasources.json`:

```json
{
  "page": {
    "title": "Prometheus 数据源",
    "subtitle": "管理 AI 解释告警时使用的 Prometheus 指标源",
    "breadcrumb": "Prometheus 数据源",
    "actions": {
      "new": "+ 新增数据源"
    },
    "empty": {
      "title": "尚未配置 Prometheus 数据源",
      "subtitle": "添加第一个开始接入告警指标源"
    }
  },
  "table": {
    "columns": {
      "name": "名称",
      "baseUrl": "Prometheus URL",
      "isDefault": "默认",
      "auth": "鉴权",
      "consumers": "关联 connection",
      "actions": "操作"
    },
    "defaultBadge": "默认",
    "setDefault": "设为默认",
    "authAnonymous": "匿名",
    "authBearer": "Bearer"
  },
  "sheet": {
    "createTitle": "新建 Prometheus 数据源",
    "editTitle": "编辑 Prometheus 数据源",
    "fields": {
      "name": { "label": "名称", "placeholder": "例如:primary-cluster" },
      "baseUrl": { "label": "Prometheus URL", "placeholder": "https://prom.example.com" },
      "bearerToken": { "label": "Bearer Token", "placeholder": "anonymous Prom 留空" },
      "customHeaders": { "label": "自定义 headers", "placeholder": "X-Tenant: foo\\nAuthorization: Basic ...", "help": "一行一个 key: value" },
      "isDefault": { "label": "设为默认", "help": "新建 Connection 时自动绑定;同时只能有一个默认" }
    },
    "actions": {
      "verify": "测试连接",
      "rotate": "轮换"
    }
  },
  "delete": {
    "title": "删除数据源 {{name}}?",
    "body": "将解绑 {{count}} 个 connection,绑定关系会被清空(connection 不会被删除)",
    "confirm": "删除"
  },
  "toast": {
    "createSuccess": "已创建",
    "updateSuccess": "已保存",
    "deleteSuccess": "已删除,解绑 {{count}} 个 connection",
    "setDefaultSuccess": "已设为默认",
    "verify": {
      "ok": "连接成功 ({{version}})",
      "fail": "失败:{{reason}}"
    }
  },
  "settings": {
    "title": "Prometheus 数据源",
    "desc": "管理 AI 解释告警时使用的指标源,默认数据源会被新建 Connection 自动绑定",
    "manage": "管理数据源"
  }
}
```

Create `apps/web/src/locales/en-US/prometheus-datasources.json` with the same shape (English text). Use natural translations; same keys.

Register the namespace in `apps/web/src/lib/i18n.ts`: find where existing namespaces are listed and add `"prometheus-datasources"`.

### Step 6.3: Write queries

```ts
// apps/web/src/features/prometheus-datasources/queries.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  type CreatePrometheusDatasource,
  type DeletePrometheusDatasourceResponse,
  type ListPrometheusDatasourcesResponse,
  type PrometheusDatasourcePublic,
  type PrometheusDatasourceWithSecret,
  type UpdatePrometheusDatasource,
  type VerifyPrometheusDatasourceRequest,
  type VerifyPrometheusDatasourceResponse,
  listPrometheusDatasourcesResponseSchema,
  prometheusDatasourcePublicSchema,
  prometheusDatasourceWithSecretSchema,
  deletePrometheusDatasourceResponseSchema,
  verifyPrometheusDatasourceResponseSchema,
} from "@modeldoctor/contracts";
import { apiFetch } from "@/lib/api-client"; // mirror existing client helper name

const KEY = ["prometheus-datasources"] as const;

export function useDatasources() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const data = await apiFetch("/api/prometheus-datasources");
      return listPrometheusDatasourcesResponseSchema.parse(data);
    },
  });
}

export function useDatasource(id: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, id ?? "_none"] as const,
    enabled: !!id,
    queryFn: async () => {
      const data = await apiFetch(`/api/prometheus-datasources/${id}`);
      return prometheusDatasourcePublicSchema.parse(data);
    },
  });
}

export function useCreateDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePrometheusDatasource) => {
      const data = await apiFetch("/api/prometheus-datasources", {
        method: "POST", body: JSON.stringify(input),
      });
      return prometheusDatasourceWithSecretSchema.parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useUpdateDatasource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePrometheusDatasource) => {
      const data = await apiFetch(`/api/prometheus-datasources/${id}`, {
        method: "PATCH", body: JSON.stringify(input),
      });
      return z
        .union([prometheusDatasourcePublicSchema, prometheusDatasourceWithSecretSchema])
        .parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useDeleteDatasource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await apiFetch(`/api/prometheus-datasources/${id}`, { method: "DELETE" });
      return deletePrometheusDatasourceResponseSchema.parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useSetDefaultDatasource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await apiFetch(`/api/prometheus-datasources/${id}/set-default`, {
        method: "POST",
      });
      return prometheusDatasourcePublicSchema.parse(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useVerifyDatasource() {
  return useMutation({
    mutationFn: async (input: VerifyPrometheusDatasourceRequest) => {
      const data = await apiFetch("/api/prometheus-datasources/verify", {
        method: "POST", body: JSON.stringify(input),
      });
      return verifyPrometheusDatasourceResponseSchema.parse(data);
    },
  });
}
```

(`apiFetch` is the existing client helper — confirm exact name with `grep -rn 'export.*function.*apiFetch\|export.*const apiFetch' apps/web/src/lib`.)

### Step 6.4: Write DatasourcesPage (list view)

```tsx
// apps/web/src/features/prometheus-datasources/DatasourcesPage.tsx
import { useState } from "react";
import { Link } from "react-router-dom"; // mirror existing import (TanStack or react-router)
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store"; // mirror existing
import { DatasourceSheet } from "./DatasourceSheet";
import {
  useDatasources,
  useDeleteDatasource,
  useSetDefaultDatasource,
} from "./queries";
import type { PrometheusDatasourcePublic } from "@modeldoctor/contracts";

export function DatasourcesPage() {
  const { t } = useTranslation("prometheus-datasources");
  const { t: tc } = useTranslation("common");
  const { data, isLoading } = useDatasources();
  const isAdmin = useAuthStore((s) => (s.user?.roles ?? []).includes("admin"));

  const [editing, setEditing] = useState<PrometheusDatasourcePublic | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PrometheusDatasourcePublic | null>(null);

  const setDefault = useSetDefaultDatasource(pendingDelete?.id ?? "");
  const del = useDeleteDatasource(pendingDelete?.id ?? "");

  return (
    <>
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        breadcrumbs={[
          { label: tc("nav.settings"), to: "/settings" },
          { label: t("page.breadcrumb") },
        ]}
        rightSlot={
          isAdmin ? (
            <Button onClick={() => setCreating(true)}>{t("page.actions.new")}</Button>
          ) : null
        }
      />
      <div className="px-8 py-6 space-y-6">
        {/* table */}
        {isLoading ? (
          <div>{tc("common.loading")}</div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title={t("page.empty.title")}
            subtitle={t("page.empty.subtitle")}
          />
        ) : (
          <DatasourceTable
            items={data.items}
            isAdmin={isAdmin}
            onEdit={(r) => setEditing(r)}
            onDelete={(r) => setPendingDelete(r)}
            onSetDefault={async (r) => {
              await useSetDefaultDatasource(r.id).mutateAsync();
              toast.success(t("toast.setDefaultSuccess"));
            }}
          />
        )}
      </div>

      {creating && (
        <DatasourceSheet
          mode="create"
          open={creating}
          onOpenChange={(o) => setCreating(o)}
        />
      )}
      {editing && (
        <DatasourceSheet
          mode="edit"
          datasource={editing}
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("delete.title", { name: pendingDelete?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.body", { count: pendingDelete?.consumersCount ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingDelete) return;
                const r = await del.mutateAsync();
                toast.success(t("toast.deleteSuccess", { count: r.consumersDetached }));
                setPendingDelete(null);
              }}
            >
              {t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Inline helpers — split into separate files only if they grow.
function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded border border-dashed p-12 text-center">
      <div className="text-lg font-medium">{title}</div>
      <div className="text-sm text-muted-foreground mt-2">{subtitle}</div>
    </div>
  );
}

function DatasourceTable(props: {
  items: PrometheusDatasourcePublic[];
  isAdmin: boolean;
  onEdit: (r: PrometheusDatasourcePublic) => void;
  onDelete: (r: PrometheusDatasourcePublic) => void;
  onSetDefault: (r: PrometheusDatasourcePublic) => void;
}) {
  const { t } = useTranslation("prometheus-datasources");
  const { t: tc } = useTranslation("common");
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground border-b">
        <tr>
          <th className="py-2">{t("table.columns.name")}</th>
          <th>{t("table.columns.baseUrl")}</th>
          <th>{t("table.columns.isDefault")}</th>
          <th>{t("table.columns.auth")}</th>
          <th>{t("table.columns.consumers")}</th>
          <th className="text-right">{t("table.columns.actions")}</th>
        </tr>
      </thead>
      <tbody>
        {props.items.map((r) => (
          <tr key={r.id} className="border-b">
            <td className="py-3">
              <button className="text-primary hover:underline" onClick={() => props.onEdit(r)}>
                {r.name}
              </button>
            </td>
            <td className="font-mono text-xs">{r.baseUrl}</td>
            <td>
              {r.isDefault ? (
                <Badge>{t("table.defaultBadge")}</Badge>
              ) : props.isAdmin ? (
                <Button size="sm" variant="ghost" onClick={() => props.onSetDefault(r)}>
                  {t("table.setDefault")}
                </Button>
              ) : null}
            </td>
            <td>{r.bearerPreview ? t("table.authBearer") : t("table.authAnonymous")}</td>
            <td>{r.consumersCount}</td>
            <td className="text-right space-x-2">
              <Button variant="link" size="sm" onClick={() => props.onEdit(r)}>
                {tc("actions.detail")}
              </Button>
              {props.isAdmin && (
                <Button variant="link" size="sm" onClick={() => props.onDelete(r)}>
                  {tc("actions.delete")}
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

(Imports for `Link`, `useAuthStore`, `apiFetch`, `EmptyState` may need adjustment based on existing patterns — read a sibling page like `ConnectionsPage.tsx` to mirror.)

### Step 6.5: Write `DatasourceSheet.tsx`

```tsx
// apps/web/src/features/prometheus-datasources/DatasourceSheet.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  createPrometheusDatasourceSchema,
  type CreatePrometheusDatasource,
  type PrometheusDatasourcePublic,
  updatePrometheusDatasourceSchema,
  type UpdatePrometheusDatasource,
} from "@modeldoctor/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormActions } from "@/components/common/form-actions";
import {
  useCreateDatasource, useUpdateDatasource, useVerifyDatasource,
} from "./queries";

type Props =
  | { mode: "create"; open: boolean; onOpenChange: (open: boolean) => void; datasource?: never }
  | {
      mode: "edit"; datasource: PrometheusDatasourcePublic;
      open: boolean; onOpenChange: (open: boolean) => void;
    };

export function DatasourceSheet(props: Props) {
  const { t } = useTranslation("prometheus-datasources");
  const { t: tc } = useTranslation("common");
  const isEdit = props.mode === "edit";

  const create = useCreateDatasource();
  const update = useUpdateDatasource(isEdit ? props.datasource.id : "");
  const verify = useVerifyDatasource();

  const [rotating, setRotating] = useState(false);

  const form = useForm<CreatePrometheusDatasource>({
    mode: "onTouched",
    resolver: zodResolver(
      (isEdit ? updatePrometheusDatasourceSchema : createPrometheusDatasourceSchema) as never,
    ),
    defaultValues: isEdit
      ? {
          name: props.datasource.name,
          baseUrl: props.datasource.baseUrl,
          bearerToken: undefined, // hidden until rotate
          customHeaders: props.datasource.customHeaders,
          isDefault: props.datasource.isDefault,
        }
      : {
          name: "", baseUrl: "", bearerToken: undefined, customHeaders: "", isDefault: false,
        },
  });

  async function onSubmit(values: CreatePrometheusDatasource | UpdatePrometheusDatasource) {
    try {
      if (isEdit) {
        await update.mutateAsync(values as UpdatePrometheusDatasource);
        toast.success(t("toast.updateSuccess"));
      } else {
        await create.mutateAsync(values as CreatePrometheusDatasource);
        toast.success(t("toast.createSuccess"));
      }
      props.onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onVerify() {
    const { baseUrl, bearerToken, customHeaders } = form.getValues();
    if (!baseUrl) return;
    const r = await verify.mutateAsync({ baseUrl, bearerToken, customHeaders });
    if (r.ok) {
      toast.success(t("toast.verify.ok", { version: r.version ?? "?" }));
    } else {
      toast.error(t("toast.verify.fail", { reason: r.reason ?? "" }));
    }
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{t(isEdit ? "sheet.editTitle" : "sheet.createTitle")}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("sheet.fields.name.label")}</FormLabel>
                  <FormControl><Input placeholder={t("sheet.fields.name.placeholder")} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="baseUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("sheet.fields.baseUrl.label")}</FormLabel>
                  <FormControl><Input placeholder={t("sheet.fields.baseUrl.placeholder")} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="bearerToken" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("sheet.fields.bearerToken.label")}</FormLabel>
                {isEdit && !rotating ? (
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded">••••{props.datasource.bearerPreview || tc("common.empty")}</code>
                    <Button type="button" size="sm" variant="outline" onClick={() => setRotating(true)}>
                      {t("sheet.actions.rotate")}
                    </Button>
                  </div>
                ) : (
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t("sheet.fields.bearerToken.placeholder")}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                )}
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="customHeaders" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("sheet.fields.customHeaders.label")}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder={t("sheet.fields.customHeaders.placeholder")}
                    {...field}
                  />
                </FormControl>
                <FormDescription>{t("sheet.fields.customHeaders.help")}</FormDescription>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="isDefault" render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div>
                  <FormLabel className="!mt-0">{t("sheet.fields.isDefault.label")}</FormLabel>
                  <FormDescription>{t("sheet.fields.isDefault.help")}</FormDescription>
                </div>
              </FormItem>
            )} />

            <SheetFooter className="border-t border-border pt-3 flex justify-between">
              <Button type="button" variant="outline" onClick={onVerify} disabled={verify.isPending}>
                {t("sheet.actions.verify")}
              </Button>
              <FormActions
                onCancel={() => props.onOpenChange(false)}
                cancelLabel={tc("actions.cancel")}
                submitLabel={tc("actions.save")}
                pending={create.isPending || update.isPending}
              />
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
```

### Step 6.6: SettingsPage entry

Open `apps/web/src/features/settings/SettingsPage.tsx`. Above the Danger Zone section (or wherever appropriate per page flow), insert:

```tsx
import { Link } from "react-router-dom";
// …
<SettingSection
  title={t("settings:prometheusDatasources.title", { ns: "prometheus-datasources" })}
  description={t("settings:prometheusDatasources.desc", { ns: "prometheus-datasources" })}
>
  <SettingRow>
    <Button variant="outline" asChild>
      <Link to="/settings/prometheus-datasources">
        {t("settings:prometheusDatasources.manage", { ns: "prometheus-datasources" })} →
      </Link>
    </Button>
  </SettingRow>
</SettingSection>
```

(Adjust translation namespace usage to match how this page consumes i18n.)

### Step 6.7: Tests (one canonical per file, more if natural)

Write `DatasourcesPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DatasourcesPage } from "./DatasourcesPage";

vi.mock("./queries", () => ({
  useDatasources: () => ({ data: { items: [] }, isLoading: false }),
  useSetDefaultDatasource: () => ({ mutateAsync: vi.fn() }),
  useDeleteDatasource: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { user: { roles: string[] } }) => unknown) =>
    sel({ user: { roles: ["admin"] } }),
}));

function renderPage() {
  const qc = new QueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <DatasourcesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DatasourcesPage", () => {
  it("renders empty state when no datasources", () => {
    renderPage();
    expect(screen.getByText(/尚未配置 Prometheus 数据源|未配置/)).toBeInTheDocument();
  });
});
```

Write `DatasourceSheet.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { DatasourceSheet } from "./DatasourceSheet";

const createMutate = vi.fn().mockResolvedValue({});
const updateMutate = vi.fn().mockResolvedValue({});
const verifyMutate = vi.fn().mockResolvedValue({ ok: true, version: "2.50" });
vi.mock("./queries", () => ({
  useCreateDatasource: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateDatasource: () => ({ mutateAsync: updateMutate, isPending: false }),
  useVerifyDatasource: () => ({ mutateAsync: verifyMutate, isPending: false }),
}));

function renderSheet(props: Parameters<typeof DatasourceSheet>[0]) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <DatasourceSheet {...props} />
    </QueryClientProvider>,
  );
}

describe("DatasourceSheet", () => {
  it("calls verify with form values", async () => {
    renderSheet({ mode: "create", open: true, onOpenChange: () => {} });
    fireEvent.change(screen.getByLabelText(/Prometheus URL/), { target: { value: "https://p.example.com" } });
    fireEvent.click(screen.getByText(/测试连接|test/i));
    await waitFor(() =>
      expect(verifyMutate).toHaveBeenCalledWith({
        baseUrl: "https://p.example.com",
        bearerToken: undefined,
        customHeaders: "",
      }),
    );
  });

  it("submit (create) triggers createMutate", async () => {
    renderSheet({ mode: "create", open: true, onOpenChange: () => {} });
    fireEvent.change(screen.getByLabelText(/名称|Name/), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(/Prometheus URL/), { target: { value: "https://p.example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: /保存|save/i }).closest("form")!);
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
  });
});
```

Write `queries.test.tsx` with at least one mocked-fetch case per hook (covering shape parse). Mirror existing query test style in this repo.

### Step 6.8: Run

```bash
pnpm -F @modeldoctor/web test -- prometheus-datasources --run
```

Expected: green.

### Step 6.9: Commit

```bash
git add apps/web/src/features/prometheus-datasources/ \
        apps/web/src/locales/zh-CN/prometheus-datasources.json \
        apps/web/src/locales/en-US/prometheus-datasources.json \
        apps/web/src/lib/i18n.ts \
        apps/web/src/router/index.tsx \
        apps/web/src/features/settings/SettingsPage.tsx
git commit -m "$(cat <<'EOF'
feat(web): /settings/prometheus-datasources 列表页 + DatasourceSheet

- 新页面 /settings/prometheus-datasources(表格 + DatasourceSheet 抽屉)
- DatasourceSheet 沿用 ConnectionSheet 形态(name/baseUrl/bearer rotate/customHeaders/isDefault + 测试连接)
- AlertDialog 删除确认(显示将解绑 N 个 connection)
- queries.ts 全套(list/get/create/update/delete/setDefault/verify),所有 mutation invalidate connections
- i18n zh-CN + en-US;SettingsPage 加入口 row
- 非 admin 隐藏增/改/删/setDefault 按钮(防绕过靠后端)

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Web — ConnectionSheet 加"指标源" + ConnectionsPage 列

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionSheet.tsx`
- Modify: `apps/web/src/features/connections/ConnectionSheet.test.tsx`
- Modify: `apps/web/src/features/connections/ConnectionsPage.tsx`
- Modify: `apps/web/src/features/connections/ConnectionsPage.test.tsx`
- Modify: `apps/web/src/features/connections/schema.ts` (if needed)

### Step 7.1: Update local `connections/schema.ts` if it duplicates the enum

```bash
grep -n 'prometheus\|connectionKind\|ConnectionKind' apps/web/src/features/connections/schema.ts
```

If `connectionKindSchema` is locally mirrored, narrow it. If the file just re-exports the contract, nothing to do here.

### Step 7.2: ConnectionsPage — kind chips narrow + 指标源 column

Open `apps/web/src/features/connections/ConnectionsPage.tsx`. Find:

```ts
{(["model", "gateway", "prometheus", "alertmanager"] as ConnectionKind[]).map(
```

Replace with:

```ts
{(["model", "gateway", "alertmanager"] as ConnectionKind[]).map(
```

Add a new column for "指标源". In the table header row, after the existing kind column add:

```tsx
<th>{t("table.columns.prometheusDatasource")}</th>
```

In each row body, render:

```tsx
<td>
  {row.prometheusDatasource ? (
    <Link
      to={`/settings/prometheus-datasources?edit=${row.prometheusDatasource.id}`}
      className="text-primary hover:underline"
    >
      {row.prometheusDatasource.name}
    </Link>
  ) : (
    <span className="text-muted-foreground">—</span>
  )}
</td>
```

(The query-param `?edit=<id>` is an interpretive optional — if you prefer simply linking to `/settings/prometheus-datasources`, that's fine. List page can read the query param to auto-open the sheet, but that wiring is optional and not required for this PR.)

Add the new i18n key `table.columns.prometheusDatasource: "指标源"` in the connections namespace (zh-CN + en-US).

### Step 7.3: ConnectionSheet — add Datasource select

Open `apps/web/src/features/connections/ConnectionSheet.tsx`. At top, add import:

```ts
import { useDatasources } from "@/features/prometheus-datasources/queries";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
```

In the form body, when `kind === "model" || kind === "gateway"`, insert a new field:

```tsx
{(kind === "model" || kind === "gateway") && (
  <FormField control={form.control} name="prometheusDatasourceId" render={({ field }) => {
    const { data: dsList } = useDatasources();
    return (
      <FormItem>
        <FormLabel>{t("dialog.fields.prometheusDatasource.label")}</FormLabel>
        <FormControl>
          <Select
            value={field.value ?? "__none__"}
            onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("dialog.fields.prometheusDatasource.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("dialog.fields.prometheusDatasource.none")}</SelectItem>
              {dsList?.items.map((ds) => (
                <SelectItem key={ds.id} value={ds.id}>
                  {ds.name}{ds.isDefault ? ` (${t("dialog.fields.prometheusDatasource.defaultSuffix")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormControl>
        <FormDescription>{t("dialog.fields.prometheusDatasource.help")}</FormDescription>
        <FormMessage />
      </FormItem>
    );
  }} />
)}
```

In the form's `useForm` defaults: include `prometheusDatasourceId: connection?.prometheusDatasourceId ?? undefined`. For **new** connections, leave it `undefined` so the API auto-fills the default; for **edit**, pre-fill the actual value.

In the form submit normalisation: drop `prometheusDatasourceId` from the payload when `kind === "alertmanager"` (or set to `null`). For other kinds, pass through.

Also: **delete** any `prometheusUrl` UI handling code (it was hidden but may exist in form state defaults — clean up).

Add i18n keys:

```json
"dialog.fields.prometheusDatasource": {
  "label": "指标源 (Prometheus 数据源)",
  "placeholder": "选择一个数据源",
  "none": "不绑定",
  "defaultSuffix": "默认",
  "help": "AI 解释告警时将从此数据源拉指标;默认是 Settings 里标记的默认数据源"
}
```

### Step 7.4: Update existing tests

`ConnectionSheet.test.tsx`: any case asserting on `kind=prometheus` — delete or change to `alertmanager`/`gateway`. Mock `useDatasources` to return a small fixture.

`ConnectionsPage.test.tsx`: drop `prometheus` from the kind-chip filter test; add a test for the new "指标源" column display.

### Step 7.5: Run

```bash
pnpm -F @modeldoctor/web test -- connections --run
```

Expected: green.

### Step 7.6: Commit

```bash
git add apps/web/src/features/connections/
git commit -m "$(cat <<'EOF'
feat(web): ConnectionSheet 加 "指标源" 字段 + ConnectionsPage 列

- ConnectionSheet: kind ∈ {model, gateway} 时渲染 prometheusDatasource 下拉
  - 选项 = 各 datasource(默认行加 后缀)+ "不绑定"
  - 新建表单不预填(undefined),让 API 自动填默认
  - 编辑表单回显 connection.prometheusDatasourceId
- ConnectionsPage: kind 过滤去掉 prometheus;新增 "指标源" 列(显示绑定的 datasource 名,可点击跳转)
- 删 prometheusUrl 残留 UI

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: MCP tools

**Files:**
- Create: `apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.ts`
- Create: `apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.spec.ts`
- Create: `apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.ts`
- Create: `apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.spec.ts`
- Modify: `apps/api/src/modules/mcp/tools/_register.ts`
- Modify: `apps/api/src/modules/mcp/tools/list-connections.tool.ts`
- Modify: `apps/api/src/modules/mcp/README.md`

### Step 8.1: list_prometheus_datasources

```ts
// apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.ts
import { z } from "zod";
import { PrometheusDatasourceService } from "../../prometheus-datasource/prometheus-datasource.service.js";
import type { McpToolHandler } from "../mcp.types.js";  // mirror existing helper type

export const listPrometheusDatasourcesTool = {
  name: "list_prometheus_datasources",
  description:
    "List every Prometheus datasource configured in ModelDoctor. The row " +
    "where isDefault=true is the one new connections will auto-bind to. " +
    "Use set_connection_prometheus_source to change a connection's binding.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        baseUrl: z.string(),
        bearerPreview: z.string(),
        isDefault: z.boolean(),
        consumersCount: z.number().int().min(0),
      }),
    ),
  }),
  buildHandler: (svc: PrometheusDatasourceService): McpToolHandler =>
    async (_input, ctx) => {
      const r = await svc.list({ sub: ctx.userId, isAdmin: ctx.roles.includes("admin") });
      return {
        items: r.items.map((d) => ({
          id: d.id,
          name: d.name,
          baseUrl: d.baseUrl,
          bearerPreview: d.bearerPreview,
          isDefault: d.isDefault,
          consumersCount: d.consumersCount,
        })),
      };
    },
};
```

(`McpToolHandler` / `ctx` shape: read an existing tool like `list-alerts.tool.ts` to mirror exact signatures.)

Test:

```ts
// apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.spec.ts
import { describe, expect, it } from "vitest";
import { listPrometheusDatasourcesTool } from "./list-prometheus-datasources.tool.js";

describe("list_prometheus_datasources tool", () => {
  it("declares correct name + description", () => {
    expect(listPrometheusDatasourcesTool.name).toBe("list_prometheus_datasources");
    expect(listPrometheusDatasourcesTool.description.length).toBeGreaterThan(20);
  });
  it("handler returns mapped shape", async () => {
    const fakeSvc = {
      list: async () => ({
        items: [{
          id: "ds1", name: "primary", baseUrl: "https://p.com",
          bearerPreview: "", customHeaders: "", isDefault: true,
          consumersCount: 2, createdAt: "x", updatedAt: "x",
        }],
      }),
    } as never;
    const handler = listPrometheusDatasourcesTool.buildHandler(fakeSvc);
    const r = await handler({}, { userId: "u1", roles: ["admin"] });
    expect(r).toEqual({
      items: [{
        id: "ds1", name: "primary", baseUrl: "https://p.com",
        bearerPreview: "", isDefault: true, consumersCount: 2,
      }],
    });
  });
});
```

### Step 8.2: set_connection_prometheus_source

```ts
// apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.ts
import { z } from "zod";
import { ConnectionService } from "../../connection/connection.service.js";
import type { McpToolHandler } from "../mcp.types.js";

const inputSchema = z.object({
  connectionId: z.string().min(1),
  datasourceId: z.string().nullable().optional(),
});

export const setConnectionPrometheusSourceTool = {
  name: "set_connection_prometheus_source",
  description:
    "Bind a connection (kind ∈ {model, gateway}) to a Prometheus datasource. " +
    "Pass datasourceId='<id>' to bind explicitly, datasourceId=null to unbind, " +
    "or omit datasourceId to fall back to the current default. " +
    "Rejected with prometheus_datasource_invalid_kind for kind=alertmanager.",
  inputSchema,
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["model", "gateway", "alertmanager"]),
    prometheusDatasourceId: z.string().nullable(),
    prometheusDatasource: z
      .object({ id: z.string(), name: z.string(), baseUrl: z.string() })
      .nullable(),
  }),
  buildHandler: (svc: ConnectionService): McpToolHandler =>
    async (input, ctx) => {
      const updated = await svc.update(ctx.userId, input.connectionId, {
        prometheusDatasourceId: input.datasourceId,
      });
      return {
        id: updated.id,
        name: updated.name,
        kind: updated.kind,
        prometheusDatasourceId: updated.prometheusDatasourceId,
        prometheusDatasource: updated.prometheusDatasource,
      };
    },
};
```

Test:

```ts
// apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.spec.ts
import { describe, expect, it } from "vitest";
import { setConnectionPrometheusSourceTool } from "./set-connection-prometheus-source.tool.js";

describe("set_connection_prometheus_source tool", () => {
  it("forwards undefined datasourceId to service", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "c1", name: "m", kind: "model",
      prometheusDatasourceId: "ds1",
      prometheusDatasource: { id: "ds1", name: "default", baseUrl: "x" },
    });
    const handler = setConnectionPrometheusSourceTool.buildHandler({ update } as never);
    const r = await handler({ connectionId: "c1" }, { userId: "u1", roles: [] });
    expect(update).toHaveBeenCalledWith("u1", "c1", { prometheusDatasourceId: undefined });
    expect(r.prometheusDatasourceId).toBe("ds1");
  });
  it("forwards null to unbind", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "c1", name: "m", kind: "model",
      prometheusDatasourceId: null, prometheusDatasource: null,
    });
    const handler = setConnectionPrometheusSourceTool.buildHandler({ update } as never);
    const r = await handler({ connectionId: "c1", datasourceId: null }, { userId: "u1", roles: [] });
    expect(update).toHaveBeenCalledWith("u1", "c1", { prometheusDatasourceId: null });
    expect(r.prometheusDatasourceId).toBeNull();
  });
});
```

### Step 8.3: Register new tools

Open `apps/api/src/modules/mcp/tools/_register.ts`. Mirror how existing tools like `listAlertsTool` are registered. Add imports + entries for both new tools.

### Step 8.4: Update existing list-connections tool description

Open `apps/api/src/modules/mcp/tools/list-connections.tool.ts:17`. Change:

```ts
"model, category, tags, serverKind, prometheusUrl). The apiKey is NEVER "
```

to:

```ts
"model, category, tags, serverKind, prometheusDatasource). The apiKey is NEVER "
```

### Step 8.5: Update MCP README

Open `apps/api/src/modules/mcp/README.md`. Find the existing tool listing format. Append entries for both new tools, mirroring existing format. Include:
- tool name
- one-line description
- input schema (TypeScript type or JSON)
- output schema summary
- one example natural-language call + tool call + response

### Step 8.6: Run tests

```bash
pnpm -F @modeldoctor/api test -- mcp/tools --run
```

Expected: green.

### Step 8.7: Commit

```bash
git add apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.ts \
        apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.spec.ts \
        apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.ts \
        apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.spec.ts \
        apps/api/src/modules/mcp/tools/_register.ts \
        apps/api/src/modules/mcp/tools/list-connections.tool.ts \
        apps/api/src/modules/mcp/README.md
git commit -m "$(cat <<'EOF'
feat(mcp): list_prometheus_datasources + set_connection_prometheus_source

- list_prometheus_datasources: 列所有 datasource (id, name, baseUrl, isDefault, consumersCount)
- set_connection_prometheus_source: 改 connection 的指标源
  - 三态语义跟 REST 一致 (undefined → default / null → unbind / string → use)
- 已存 list_connections tool 描述 prometheusUrl → prometheusDatasource
- README 加 2 段使用示例

addresses #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final cross-cuts — workspace gates, manual smoke, PR

### Step 9.1: Workspace-wide checks

```bash
pnpm -r type-check
pnpm -F @modeldoctor/web lint
pnpm -r build
```

All must be clean. Fix anything that errors.

### Step 9.2: Full test sweep

```bash
pnpm -r test --run
```

Optional: `pnpm test:e2e:browser` for Playwright smoke (if available locally and dev DB is in a state Playwright can reset).

### Step 9.3: Manual browser smoke

Start dev server:

```bash
pnpm dev
```

In browser:
1. `/settings` → 看到 "Prometheus 数据源" section → 点 manage 跳到 `/settings/prometheus-datasources`
2. 点 "+ 新增数据源" 打开 sheet → 填 name + baseUrl(指向 `http://localhost:9090` 或 mock)→ 点"测试连接" → toast 出
3. 标 "设为默认" → 保存 → 列表里 default badge 显示
4. 去 `/connections` → 新建一个 kind=model connection → 看下拉是否默认预选了刚才创建的 datasource
5. 编辑 connection,改成"不绑定",保存 → 列表里 "指标源" 列显示 "—"
6. 列表页删除 datasource → 弹窗显示 "将解绑 N 个 connection"

After validating, **kill the dev server** (per `feedback_subagent_process_cleanup`).

### Step 9.4: Push + open PR

```bash
git push -u origin feat/prometheus-datasource
gh pr create --title "feat: PrometheusDatasource — admin-managed 指标源 + Connection 绑定 + AI explainer Prom 接入 (addresses #189)" --body "$(cat <<'EOF'
## Summary

- 新独立 `PrometheusDatasource` 系统级表;`kind=prometheus` 从 Connection 收窄出去
- `Connection.prometheusDatasourceId` 三态绑定 (undefined→default / null→unbind / id)
- `/settings/prometheus-datasources` 列表页 + `DatasourceSheet`(沿用 `ConnectionSheet` 形态)
- `ConnectionSheet` 加"指标源"下拉 + `ConnectionsPage` 加"指标源"列
- 2 个 MCP tools (list / set source)
- `AlertExplainerService` 新增 `PrometheusFetcherService`:重跑 alert expr (query_range ±5/15min) → 摘要喂 prompt;失败回退 baseline-only
- 单 PR phase-per-commit(9 commits)

## Test plan

- [x] api unit + e2e:`pnpm -F @modeldoctor/api test --run` / `pnpm -F @modeldoctor/api test:e2e --run`
- [x] web unit:`pnpm -F @modeldoctor/web test --run`
- [x] contracts:`pnpm -F @modeldoctor/contracts test --run`
- [x] `pnpm -r type-check` clean
- [x] `pnpm -F @modeldoctor/web lint` clean
- [x] `pnpm -r build` clean
- [ ] Manual browser smoke per plan §Task 9.3

## Migration notes

- Schema migration migrates existing `kind=prometheus` Connection rows into new table; deletes them post-migration. Backfills `connection.prometheus_datasource_id` from legacy `prometheus_url` by base_url match.
- Breaking contract: `connectionKindSchema` 去掉 `prometheus`;`connectionPublicSchema` 去掉 `prometheusUrl`,加 `prometheusDatasourceId` + `prometheusDatasource`.

## Follow-ups

- Alertmanager 同构(把 `kind=alertmanager` 也搬出 Connection 进独立表)— 评论补在 #189
- `set_default_prometheus_datasource` MCP tool — 评论补在 #189
- CLAUDE.md "Page vs Dialog" 段引用 `ConnectionDialog`(实物 Sheet),doc 修订独立 PR

addresses #189

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 9.5: PR follow-through (per CLAUDE.md "PR follow-through")

```bash
gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks <N>
gh api repos/weetime/modeldoctor/pulls/<N>/comments
```

Surface any reviewer / CI signals; address inline.

### Step 9.6: Post follow-up comment on #189

```bash
gh issue comment 189 --body "$(cat <<'EOF'
PrometheusDatasource (PR #<N>) 落地。延后/未做的范围:

- **Alertmanager 同构**:把 `kind=alertmanager` 也搬出 Connection 进独立 `AlertmanagerDatasource` 表(同样无业务依赖,延后无成本)— 单开 follow-up issue。
- **`set_default_prometheus_datasource` MCP tool**:admin-only 系统全局变更,LLM 通常不该代用户做;真有 Claude Code agent 切默认 Prom 的需求再补。
- **CLAUDE.md "Page vs Dialog" 段** 引用了 `ConnectionDialog`,实物是 `ConnectionSheet.tsx`(沿用 Sheet 形态)— doc 修订独立小 PR。
EOF
)"
```

---

## Self-Review (done by plan author before handoff)

### Spec coverage check

| Spec section | Covered by task(s) |
|---|---|
| §1 Schema (new table, FK, drop prometheusUrl, narrow enum) | Task 1 (contracts) + Task 2 (Prisma + migration) |
| §1 Migration steps 1-7 | Task 2 Step 2.3 |
| §2 API contracts (zod) | Task 1 |
| §2 Routes (CRUD + verify + set-default) | Task 3 |
| §2 Connection augmentation (三态语义) | Task 4 |
| §2 Admin guard pattern | Task 3 (service `requireAdmin`) |
| §3.A DatasourcesPage | Task 6 |
| §3.B SettingsPage entry | Task 6 |
| §3.C DatasourceSheet (Sheet) | Task 6 |
| §3.D ConnectionSheet field + ConnectionsPage column | Task 7 |
| §3.E queries.ts | Task 6 |
| §3.F i18n | Task 6 |
| §4 MCP tools | Task 8 |
| §5 PrometheusFetcherService (resolve datasource, expr, query_range, summarise) | Task 5 |
| §5 Explainer integration (prompt section, sys-prompt sentence) | Task 5 |
| §5 Tests (fetcher unit, explainer unit, e2e) | Task 5 |
| PR形态 (9 commits) | Task 1-8 commits = 8 commits; pre-flight + Task 9 don't commit. Matches "phase-per-commit" |
| Follow-up comment on #189 | Task 9.6 |

No gaps.

### Placeholder scan

- No "TBD" / "TODO" / "implement later" in any task body.
- All code blocks are complete.
- Where exact API/import shapes depend on existing helpers (`apiFetch`, `bootstrapTestApp`, `actorFrom`), plan explicitly directs the implementer to "read sibling file X to mirror" — concrete enough to follow.

### Type consistency

- `PrometheusDatasourcePublic` shape consistent across contracts (Task 1) → service `toPublic` (Task 3) → queries (Task 6) → MCP output (Task 8).
- Three-state semantics phrasing consistent across contracts refine (Task 1), service `resolvePrometheusDatasourceId` (Task 4), MCP handler (Task 8).
- `consumersCount` field name same in contracts + service + MCP.
- `CONNECTION_API_KEY_ENC_KEY` DI token referenced consistently in service (Task 3) + fetcher (Task 5).

No drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-prometheus-datasource.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
