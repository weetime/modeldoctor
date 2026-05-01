# Issue #37 — Connections from `localStorage` to encrypted backend storage

**Status:** Draft — pending user approval
**Date:** 2026-05-01
**Branch:** `feat/connections-backend`
**Predecessors:**

- `2026-04-22-nestjs-backend-refactor-design.md` — established the NestJS backend, `apps/api/src/modules/connection/` skeleton (identity-only), `common/crypto/aes-gcm.ts`, env validation harness.
- `2026-04-27-connection-base-url-design.md` — renamed `apiUrl → apiBaseUrl` (zustand) and established "Connection is identity-only, apiType is per-test". The `apiBaseUrl` semantics carry over.

This spec covers issue [#37 — `[A1] 把 connections 从 localStorage 迁到后端加密存储`](https://github.com/weetime/modeldoctor/issues/37). It unifies the two parallel `Connection` concepts that exist today (a dormant backend `connections` table, and the live frontend zustand-persisted credential bookmarks) into a single backend-owned, encrypted-at-rest, server-resolved entity. After this change, plaintext API keys never leave the backend on the call path.

## 1. Purpose and Scope

### 1.1 Problem

`apps/web` stores `connections` (full curl bookmarks: base URL + apiKey + model + custom headers + query params) in browser `localStorage` via a zustand `persist` slice. This is unsafe and inconvenient:

- **Single-device binding.** Switch browser or machine → all connections lost.
- **XSS exposure.** Any XSS exfiltrates every saved API key in plaintext.
- **No multi-user / multi-device sharing.**
- **Plaintext on the wire on every test run.** Today every `/api/playground/*`, `/api/load-test/*`, `/api/e2e/*`, `/api/benchmark/*` call carries the user's `apiKey` in the request body — even though the actual upstream call is server-side. The plaintext key round-trips browser → server → upstream on every test invocation.

A backend `connections` table already exists (Prisma `connections`, NestJS `ConnectionModule`) but is **dormant**: defined for a future use case, exposed at `/api/connections`, never called by the web. It carries identity-only fields (`name`, `baseUrl`, `apiType`, `prometheusUrl`, `serverKind`) — no credentials. Encryption infrastructure (`apps/api/src/common/crypto/aes-gcm.ts`, AES-256-GCM, env-keyed) is also in place and used for `Run.apiKeyCipher` per-run snapshots in benchmark today.

The Prisma schema for `Run.apiKeyCipher` even has the in-tree comment: `// moved from benchmark_runs (#37 may relocate to Connection)`. This spec executes that relocation.

### 1.2 What this spec delivers

- **Single Connection table.** Extend the dormant backend `Connection` to be the only Connection concept. Add credential + metadata fields the frontend already had (`model`, `customHeaders`, `queryParams`, `category`, `tags`) plus the new `apiKeyCipher` (AES-256-GCM at rest). Drop fields the frontend doesn't use (`apiType`, `prometheusUrl`, `serverKind`).
- **`apiKey` never leaves the backend** on the call path. Test invocations (`/api/playground/*`, `/api/load-test/*`, `/api/e2e/*`, `/api/benchmark/*`) accept `connectionId` and resolve credentials server-side via `ConnectionService.getOwnedDecrypted(userId, id)`.
- **`apiKeyPreview`** (e.g. `sk-...abcd`) is the only key-related field on the public list/detail responses. Plaintext `apiKey` is returned exactly **once**, in the immediate response of `POST /api/connections` and (when changed) `PATCH /api/connections/:id` — not displayed in any UI in the v1 of this change.
- **Frontend zustand `useConnectionsStore` is removed entirely.** React Query hooks (matching the existing `apps/web/src/features/benchmark/queries.ts` pattern) replace it.
- **EndpointPicker becomes read-only after pick.** "Want to tweak a field" routes through "Edit this connection" or "Save as new connection" — never a free-form local override.
- **Env var renamed** `CONNECTION_API_KEY_ENCRYPTION_KEY` → `CONNECTION_API_KEY_ENCRYPTION_KEY` to reflect the new home.
- **No data migration.** Old localStorage entries are dropped (`zustand persist version` bump, no `migrate` function — same pattern as `2026-04-27`). Old `connections` rows in DB and old `Run.apiKeyCipher` values are wiped via a Prisma migration that DROPs and re-creates affected columns. Pre-prod no-compat-shims rule (memory: `feedback_no_compat_shims`).

### 1.3 Explicit non-goals

- **No backwards-compat dual path.** Backend will not accept the old `apiBaseUrl/apiKey/model/...` fields on `/api/playground/*`, `/api/load-test/*`, `/api/e2e/*`, or `/api/benchmark/*`. After this PR, request body must be `{ connectionId, ...business params }`.
- **No automatic localStorage→backend migration UI.** Issue #37's text suggested a "one-time confirm-import dialog"; project convention since the 2026-04-27 spec is "drop old persisted state on schema bump". User explicitly opted into the latter ("不用关心老的数据 统统都可以丢弃").
- **No `prometheusUrl` / `serverKind`** on the merged Connection. They were added on the dormant backend `Connection` for issue #60 (Prometheus integration / server-kind autodetect) but #60 is not yet started; YAGNI per user direction. #60 will re-add what it needs.
- **No `apiType` on Connection.** Per `2026-04-27` spec: each test type carries its own `apiType` per-request. The dormant backend Connection had `apiType` from before that decision; this spec removes it.
- **No per-Run `apiKeyCipher` snapshot.** Re-running an old Run uses the **current** Connection's apiKey. If a user edits the apiKey between original run and re-run, the re-run uses the new key. We accept this; if a per-run snapshot is needed later, re-add the column then.
- **No "ad-hoc / scratch" mode** for pasting a curl + running once without saving. Must save Connection first. (User can name it `scratch-…` and delete after.)
- **No team / shared-org connections.** Single user owns each connection. RBAC is per-user; cross-user access yields `ForbiddenException`.
- **No KMS / Vault.** Continue with env-injected master key. Key rotation is a future ops concern.
- **No "show plaintext apiKey" UI** anywhere in the web app. The contracts `ConnectionWithSecret` schema returns plaintext on create / apiKey-rewrite for completeness, but the web UI ignores it (input field UX is regular password-style: type → submit → forget).
- **No restoration of historical `Run` rows.** All wiped by `prisma migrate reset`.
- **No `ConnectionsImportDialog`.** The current JSON import/export of localStorage data is removed; once data lives on the backend, cross-machine portability is a server-side concern (not in scope this PR).

### 1.4 Why one PR

The schema change, contracts change, four upstream-call rewrites, and the web rewrite are all coupled — each leaves the system in a half-state if landed alone. Single PR with logically grouped commits, each individually green (type-check + lint + vitest unit + prisma migrate).

## 2. Architecture

### 2.1 Before vs. after

```
BEFORE (plaintext on every call)
─────────────────────────────────────────────
Browser localStorage:  zustand persist
                       → connections[] (含明文 apiKey)
       ↓                                   ↑
playground / load-test / e2e / benchmark  ConnectionsPage
request body: { apiBaseUrl, apiKey,        (CRUD against zustand)
                model, customHeaders,
                queryParams, ...biz }
       ↓
NestJS API → upstream LLM
(per-run apiKeyCipher snapshot for benchmark only)


AFTER (apiKey never leaves backend)
─────────────────────────────────────────────
Browser (React Query cache, in-memory only):
                       → ConnectionPublic[] (无 apiKey, 仅 apiKeyPreview)
       ↓                                   ↑
playground / load-test / e2e / benchmark  ConnectionsPage
request body: { connectionId, ...biz }    (CRUD via /api/connections)
       ↓
NestJS API:
  ConnectionService.getOwnedDecrypted(userId, id)
  → AES-256-GCM decrypt → upstream LLM
       ↑
PostgreSQL connections (apiKeyCipher column, AES-256-GCM at rest)
```

### 2.2 Trust boundary

- **Server-side only:** plaintext `apiKey` (in-memory, after decrypt, until handed to upstream HTTP call). The master key (`CONNECTION_API_KEY_ENCRYPTION_KEY`) is loaded once into `ConnectionService` at module init.
- **Database:** ciphertext only (`connections.api_key_cipher`).
- **Wire (HTTP):** ciphertext never sent. Plaintext is sent **once** in `POST /api/connections` request (user-supplied) and returned once in the immediate response — not displayed in any UI.
- **Browser:** `apiKeyPreview` only on list/detail. No plaintext in any in-memory cache, redux/zustand, or React Query state.

### 2.3 Data ownership

Every `Connection` row is owned by exactly one `User` (`userId`). All controller actions enforce ownership via `JwtAuthGuard` + `findOwned` checks (returns `ForbiddenException` on mismatch). `Run` rows reference `Connection` via `connectionId`; on `Connection` delete, `Run.connectionId` is set NULL (matches existing `onDelete: SetNull` semantics on `Run.userId`).

## 3. Schema

### 3.1 Prisma `Connection` (rewritten)

```prisma
model Connection {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  name          String
  baseUrl       String   @map("base_url")
  apiKeyCipher  String   @map("api_key_cipher")  // AES-256-GCM v1, see common/crypto/aes-gcm.ts
  model         String
  customHeaders String   @default("") @map("custom_headers")  // raw string (HTTP/1.1 line-per-line); backend parses on use
  queryParams   String   @default("") @map("query_params")    // raw string (key=value&...); backend appends to upstream URL
  category      String   // ModalityCategory enum: 'chat' | 'embeddings' | 'rerank' | 'images' | 'audio' | ...
  tags          String[] @default([])

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs Run[]

  @@unique([userId, name])
  @@index([userId])
  @@map("connections")
}
```

Changes vs. current `Connection`:

- **Remove:** `apiType`, `prometheusUrl`, `serverKind`.
- **Add:** `apiKeyCipher`, `model`, `customHeaders`, `queryParams`, `category`, `tags`.
- **Add unique:** `@@unique([userId, name])` reflecting the existing zustand in-memory uniqueness.

### 3.2 Prisma `Run.apiKeyCipher` removed

```prisma
// before
apiKeyCipher String? @map("api_key_cipher") // AES-256-GCM ciphertext
// after — column removed entirely
```

`Run.connectionId` already exists; rerun-from-history flows look up the Connection via that FK.

### 3.3 Migration strategy

Append one new migration `apps/api/prisma/migrations/<timestamp>_connections_credentials_refactor/`:

```bash
# 1. Edit apps/api/prisma/schema.prisma per §3.1 + §3.2.
# 2. Generate migration:
pnpm -F @modeldoctor/api prisma migrate dev --name connections_credentials_refactor
# 3. In dev, optionally reset to wipe pre-existing rows:
pnpm -F @modeldoctor/api prisma migrate reset --force
```

The migration file's contents will be: DROP COLUMN `connections.api_type`, `prometheus_url`, `server_kind`; ADD COLUMN `connections.api_key_cipher`, `model`, `custom_headers`, `query_params`, `category`, `tags`; ADD UNIQUE `(user_id, name)`; DROP COLUMN `runs.api_key_cipher`. Because no historical data is preserved (per user direction), the column ADDs use `NOT NULL` without a backfill default — `migrate reset` is the path to a clean DB. The existing migration history (`20260427080425_init`, `20260427132334_refresh_token_rotation_chain`, `20260501030756_unified_run_model`) is preserved and the new migration appends.

### 3.4 Contracts (`packages/contracts/src/connection.ts`, rewritten)

```ts
import { z } from "zod";
import { modalityCategorySchema } from "./modality.js";

// What clients see on list / detail (no plaintext apiKey, only preview).
export const connectionPublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKeyPreview: z.string(), // e.g. "sk-...abcd" — first 3 + last 4 chars of plaintext
  model: z.string().min(1),
  customHeaders: z.string(),
  queryParams: z.string(),
  category: modalityCategorySchema,
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConnectionPublic = z.infer<typeof connectionPublicSchema>;

// Returned exactly once in POST /api/connections response, and in PATCH response when apiKey changes.
export const connectionWithSecretSchema = connectionPublicSchema.extend({
  apiKey: z.string(),
});
export type ConnectionWithSecret = z.infer<typeof connectionWithSecretSchema>;

export const createConnectionSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().default(""),
  queryParams: z.string().default(""),
  category: modalityCategorySchema,
  tags: z.array(z.string()).default([]),
});
export type CreateConnection = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = createConnectionSchema.partial();
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;

export const listConnectionsResponseSchema = z.object({
  items: z.array(connectionPublicSchema),
});
export type ListConnectionsResponse = z.infer<typeof listConnectionsResponseSchema>;
```

Removed from contracts: `connectionApiTypeSchema`, `serverKindSchema`, the old `connectionSchema` (replaced by the public + with-secret pair).

### 3.5 Contracts: call-site request schemas

Every request schema for endpoints that previously took inline credentials replaces those fields with `connectionId: z.string()`. Verified schema names in current code:

| File | Schema | Change |
|---|---|---|
| `packages/contracts/src/playground.ts` | `PlaygroundChatRequestSchema` | drop `apiBaseUrl/apiKey/model/customHeaders/queryParams`, add `connectionId` |
| `packages/contracts/src/playground.ts` | `PlaygroundEmbeddingsRequestSchema` | same |
| `packages/contracts/src/playground.ts` | `PlaygroundRerankRequestSchema` | same |
| `packages/contracts/src/playground.ts` | `PlaygroundImagesRequestSchema` | same |
| `packages/contracts/src/playground.ts` | `PlaygroundImagesEditMultipartFieldsSchema` | same |
| `packages/contracts/src/playground.ts` | `PlaygroundTtsRequestSchema` | same |
| `packages/contracts/src/playground.ts` | `PlaygroundTranscriptionsBodySchema` | same |
| `packages/contracts/src/load-test.ts` | `LoadTestRequestSchema` | same; `apiType` stays (per-test, per `2026-04-27` spec) |
| `packages/contracts/src/e2e-test.ts` | `E2ETestRequestSchema` | same |
| `packages/contracts/src/benchmark.ts` | `CreateBenchmarkRequestSchema` | same |
| `packages/contracts/src/run.ts` | `runSchema.apiKeyCipher` | **removed** (DB column also removed) |

## 4. Backend services

### 4.1 `ConnectionService` (rewritten)

`apps/api/src/modules/connection/connection.service.ts`:

```ts
@Injectable()
export class ConnectionService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) {
      throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    }
    this.key = decodeKey(k);
  }

  async create(userId: string, input: CreateConnection): Promise<ConnectionWithSecret> {
    const apiKeyCipher = encrypt(input.apiKey, this.key);
    const row = await this.prisma.connection.create({
      data: {
        userId,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKeyCipher,
        model: input.model,
        customHeaders: input.customHeaders,
        queryParams: input.queryParams,
        category: input.category,
        tags: input.tags,
      },
    });
    return toContractWithSecret(row, input.apiKey, this.makePreview(input.apiKey));
  }

  async list(userId: string): Promise<ListConnectionsResponse> {
    const rows = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: rows.map((r) => toContractPublic(r, this.makePreview(decrypt(r.apiKeyCipher, this.key)))),
    };
  }

  async findOwnedPublic(userId: string, id: string): Promise<ConnectionPublic> {
    const row = await this.findOwnedRow(userId, id);
    return toContractPublic(row, this.makePreview(decrypt(row.apiKeyCipher, this.key)));
  }

  async update(
    userId: string,
    id: string,
    input: UpdateConnection,
  ): Promise<ConnectionWithSecret | ConnectionPublic> {
    await this.findOwnedRow(userId, id);
    const data: Prisma.ConnectionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.model !== undefined) data.model = input.model;
    if (input.customHeaders !== undefined) data.customHeaders = input.customHeaders;
    if (input.queryParams !== undefined) data.queryParams = input.queryParams;
    if (input.category !== undefined) data.category = input.category;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.apiKey !== undefined) data.apiKeyCipher = encrypt(input.apiKey, this.key);

    const row = await this.prisma.connection.update({ where: { id }, data });

    if (input.apiKey !== undefined) {
      return toContractWithSecret(row, input.apiKey, this.makePreview(input.apiKey));
    }
    return toContractPublic(row, this.makePreview(decrypt(row.apiKeyCipher, this.key)));
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwnedRow(userId, id);
    await this.prisma.connection.delete({ where: { id } });
  }

  /**
   * INTERNAL — invoked by playground/load-test/e2e/benchmark services to obtain
   * decrypted credentials for an upstream call. Not exposed via HTTP.
   */
  async getOwnedDecrypted(userId: string, id: string): Promise<DecryptedConnection> {
    const row = await this.findOwnedRow(userId, id);
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKey: decrypt(row.apiKeyCipher, this.key),
      model: row.model,
      customHeaders: row.customHeaders,
      queryParams: row.queryParams,
      category: row.category as ModalityCategory,
    };
  }

  private async findOwnedRow(userId: string, id: string): Promise<PrismaConnection> {
    const row = await this.prisma.connection.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return row;
  }

  private makePreview(apiKey: string): string {
    if (apiKey.length <= 7) return apiKey; // very short keys: just return as-is (avoid empty preview)
    return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
  }
}
```

`DecryptedConnection` is a NestJS-internal TypeScript type, **not** exported via `@modeldoctor/contracts`, to enforce server-only usage.

`ConnectionModule` exports `ConnectionService` so `PlaygroundModule`, `LoadTestModule`, `E2ETestModule`, `BenchmarkModule` can import and inject it.

### 4.2 `ConnectionController` (rewritten)

Routes:

```
GET    /api/connections              ListConnectionsResponse (items: ConnectionPublic[])
POST   /api/connections              ConnectionWithSecret    (plaintext apiKey returned once)
GET    /api/connections/:id          ConnectionPublic
PATCH  /api/connections/:id          ConnectionWithSecret | ConnectionPublic
DELETE /api/connections/:id          204 No Content
```

`@UseGuards(JwtAuthGuard)` already applied. Zod validation pipe on body. `@@unique([userId, name])` violation surfaces as Prisma `P2002` → translated to HTTP 409 by the global filter (existing pattern).

### 4.3 Call-site rewrites: `playground` / `load-test` / `e2e-test` / `benchmark`

For each of the four modules, the controller method shape changes uniformly:

```ts
// before
@Post("chat")
@UseGuards(JwtAuthGuard)
async chat(
  @CurrentUser() user: JwtPayload,
  @Body(new ZodValidationPipe(playgroundChatRequestSchema)) body: PlaygroundChatRequest,
) {
  // body.apiBaseUrl, body.apiKey, body.model, body.customHeaders, body.queryParams
  return this.service.chat({ baseUrl: body.apiBaseUrl, apiKey: body.apiKey, ... }, body);
}

// after
@Post("chat")
@UseGuards(JwtAuthGuard)
async chat(
  @CurrentUser() user: JwtPayload,
  @Body(new ZodValidationPipe(playgroundChatRequestSchema)) body: PlaygroundChatRequest,
) {
  const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
  return this.service.chat(conn, body);
}
```

Each service then uses `conn.baseUrl`, `conn.apiKey`, `conn.model`, `conn.customHeaders`, `conn.queryParams` exactly as it consumed those request fields before. The OpenAI client / vegeta wrapper / guidellm driver / probe runner — all internal helpers — remain unchanged in interface.

**LoadTest path construction** (per `2026-04-27-connection-base-url-design.md` §3.1) still uses `loadTestApiTypePath(req.apiType)` with `apiType` carried on the request body (not on the connection). Final URL: `${conn.baseUrl}${loadTestApiTypePath(req.apiType)}`.

**Benchmark drivers** (subprocess + k8s manifest) currently take `BenchmarkExecutionContext.apiUrl` / `.apiKey` etc. The shape of `BenchmarkExecutionContext` stays the same; the `BenchmarkService` populates it from `getOwnedDecrypted` instead of from the request body.

**E2E probes** read from `ProbeCtx { apiBaseUrl, apiKey, model, extraHeaders }` (per the predecessor spec). `E2ETestService.run` builds `ProbeCtx` from `getOwnedDecrypted` instead of request body.

### 4.4 Env config

`apps/api/src/config/env.schema.ts`:

```ts
// before
CONNECTION_API_KEY_ENCRYPTION_KEY: z.string().refine(/* 32-byte base64 */).optional(),
// + dev/prod refinement

// after
CONNECTION_API_KEY_ENCRYPTION_KEY: z.string().refine(/* 32-byte base64 */).optional(),
// + dev/prod refinement (required outside `NODE_ENV=test`)
```

`.env.example` line `CONNECTION_API_KEY_ENCRYPTION_KEY=` → `CONNECTION_API_KEY_ENCRYPTION_KEY=`.

`deploy/` k8s configmaps / docker-compose env vars: same rename. Search-and-replace task in commit 1.

## 5. Web layer

### 5.1 React Query layer (new `apps/web/src/features/connections/queries.ts`)

Following `apps/web/src/features/benchmark/queries.ts` pattern. Sketch:

```ts
import { api } from "@/lib/api-client";
import type {
  ConnectionPublic,
  ConnectionWithSecret,
  CreateConnection,
  ListConnectionsResponse,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const KEY = ["connections"] as const;
const detailKey = (id: string) => [...KEY, id] as const;

export function useConnections() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ListConnectionsResponse>("/api/connections"),
    select: (r) => r.items,
  });
}

export function useConnection(id: string | null | undefined) {
  return useQuery({
    queryKey: detailKey(id ?? ""),
    enabled: !!id,
    queryFn: () => api.get<ConnectionPublic>(`/api/connections/${id}`),
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConnection) =>
      api.post<ConnectionWithSecret>("/api/connections", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateConnection }) =>
      api.patch<ConnectionWithSecret | ConnectionPublic>(`/api/connections/${id}`, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

The current `api` helper in `apps/web/src/lib/api-client.ts` exposes `get / post / del` but **not `patch`**. Add a `patch` method matching the `post` shape. Tiny addition; included in commit 3.

### 5.2 Removal: `useConnectionsStore`

- Delete `apps/web/src/stores/connections-store.ts` and `connections-store.test.ts`.
- Delete `apps/web/src/types/connection.ts` (`Connection`, `EndpointValues`, `emptyEndpointValues`, `ConnectionsExport`). Re-import `ConnectionPublic` / `ConnectionWithSecret` from `@modeldoctor/contracts` at every usage site.
- `selectedConnectionId` per-feature state in `playground` / `load-test` / `e2e-smoke` / `benchmark` zustand stores **stays**. Only the connection *content* lookup migrates from "zustand `.get(id)`" to "React Query `useConnection(id).data`".

### 5.3 `ConnectionsPage` (rewritten)

- List view from `useConnections()`. Loading + error states use the project's standard skeleton + error pattern.
- Table column "API Key" displays `apiKeyPreview` only.
- "Create Connection" button → `ConnectionDialog` in create mode, calls `useCreateConnection()`. Success → toast → close. **No "show plaintext once" modal** (per user direction; user just typed the key, no re-display value).
- Row "Edit" → `ConnectionDialog` in edit mode, prefilled from `useConnection(id)`. The apiKey field shows `apiKeyPreview` as placeholder + a "Reset apiKey" toggle. With toggle off, the form omits `apiKey` in the PATCH body. With toggle on, the input becomes editable + required, and the PATCH body includes `apiKey`. Server returns `ConnectionWithSecret` only when `apiKey` is included.
- Row "Delete" → confirm modal → `useDeleteConnection()`.

### 5.4 `ConnectionsImportDialog` deleted

The current JSON import/export tied to localStorage is removed. If cross-machine portability is needed later, that's a server-side feature (curl import that creates Connection rows directly).

### 5.5 `EndpointPicker` (re-shaped per Q4 decision)

```
[选择 connection]  ▼  [my-vllm-prod]
─────────────────────────────────────
Base URL:        http://10.x.x.x:30888       (read-only)
API Key:         sk-...abcd                  (read-only, preview)
Model:           gen-studio_…                (read-only)
Headers:         (read-only block)
Query Params:    (read-only)
─────────────────────────────────────
[编辑此连接 →]    [另存为新连接 →]

→ POST http://10.x.x.x:30888/v1/chat/completions   (preview line, where applicable)
```

- "编辑此连接" → opens the same `ConnectionDialog` as the ConnectionsPage edit flow, in a modal overlay. On save, React Query invalidates → form re-renders with new fields.
- "另存为新连接" → opens `ConnectionDialog` in create mode with the current connection's fields prefilled (except `apiKey` — user must re-enter; the picker only knows `apiKeyPreview`). On create, auto-select the newly created connection.

The preview line (`→ POST ${baseUrl}${loadTestApiTypePath(activeApiType)}`) from the predecessor spec stays.

### 5.6 Call-site updates: `playground` / `load-test` / `e2e` / `benchmark`

Affected web files (verified by `grep -l useConnectionsStore`):

```
apps/web/src/features/benchmark/BenchmarkEndpointFields.tsx
apps/web/src/features/request-debug/RequestDebugPage.tsx
apps/web/src/features/settings/SettingsPage.tsx
apps/web/src/features/playground/CategoryEndpointSelector.tsx
apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx
apps/web/src/features/playground/chat/ChatPage.tsx
apps/web/src/features/playground/chat-compare/ChatComparePage.tsx
apps/web/src/features/playground/image/ImagePage.tsx
apps/web/src/features/playground/image/InpaintMode.tsx
apps/web/src/features/playground/audio/SttTab.tsx
apps/web/src/features/playground/audio/TtsTab.tsx
apps/web/src/features/playground/audio/AudioPage.tsx
apps/web/src/features/playground/rerank/RerankPage.tsx
apps/web/src/features/connections/ConnectionDialog.tsx
apps/web/src/features/connections/ConnectionsPage.tsx
apps/web/src/components/connection/EndpointPicker.tsx
```

(plus their `.test.tsx` siblings, plus `apps/web/src/locales/{zh-CN,en-US}/connections.json` for the keys listed in §5.7.)

Common transformation pattern in each file:

```tsx
// before
const conn = useConnectionsStore.getState().get(selectedConnectionId);
if (!conn) return;
const body: PlaygroundChatRequest = {
  apiBaseUrl: conn.apiBaseUrl,
  apiKey: conn.apiKey,
  model: conn.model,
  customHeaders: conn.customHeaders || undefined,
  queryParams: conn.queryParams || undefined,
  messages, params,
};

// after
if (!selectedConnectionId) return;
const body: PlaygroundChatRequest = {
  connectionId: selectedConnectionId,
  messages, params,
};
```

For displaying connection metadata in the form (read-only) the page calls `useConnection(selectedConnectionId)` and reads `data.baseUrl`, `data.apiKeyPreview`, `data.model`, etc.

**Duplicate-run / rerun flows** (e.g. benchmark "duplicate" button reading from a `Run` row): now read `run.connectionId`, set `selectedConnectionId` to it, no apiKey roundtrip. If the original Connection has been deleted (`run.connectionId === null`), surface a "the saved connection no longer exists — please pick another" error.

### 5.7 i18n

`apps/web/src/locales/{zh-CN,en-US}/connections.json` adds keys for:

- "API key 已加密存储于云端" / "API key is stored encrypted on the server" — informational note in Create dialog.
- "重新设置 API key" / "Reset API key" — toggle label in Edit dialog.
- "编辑此连接" / "Edit this connection" — EndpointPicker button.
- "另存为新连接" / "Save as new connection" — EndpointPicker button.
- "保存的连接已被删除，请选择其他连接" / "Saved connection no longer exists" — duplicate-run error.

## 6. Phase decomposition (single PR, four logical commits)

Single PR `feat/connections-backend` cut from `origin/main`. Each commit individually green (type-check + biome + vitest unit; commit 2 also runs prisma migrate).

### Commit 1 — `refactor(contracts): connection schema for backend-stored credentials`

- Rewrite `packages/contracts/src/connection.ts`: drop `apiType/serverKind` schemas; add `connectionPublicSchema`, `connectionWithSecretSchema`, updated `createConnectionSchema`/`updateConnectionSchema`/`listConnectionsResponseSchema`.
- Update `playground/load-test/e2e-test/benchmark` request schemas: drop inline credential fields, add `connectionId`.
- Drop `apiKeyCipher` from `runSchema`.
- Update tests in `packages/contracts/`.
- All other packages still fail type-check; fixed in commits 2 + 3.

### Commit 2 — `refactor(api): connection-owned credentials, env rename, callers via getOwnedDecrypted`

- `apps/api/prisma/schema.prisma`: rewrite `Connection` model; drop `Run.apiKeyCipher`.
- `pnpm -F @modeldoctor/api db:migrate:reset --force` then `db:migrate:dev --name connections_credentials_refactor`.
- `apps/api/src/config/env.schema.ts`: rename `CONNECTION_API_KEY_ENCRYPTION_KEY` → `CONNECTION_API_KEY_ENCRYPTION_KEY`.
- `.env.example`: same rename.
- `apps/api/src/modules/connection/connection.service.ts`: rewrite per §4.1.
- `apps/api/src/modules/connection/connection.controller.ts`: rewrite per §4.2.
- `apps/api/src/modules/connection/connection.module.ts`: export `ConnectionService`.
- `apps/api/src/modules/{playground,load-test,e2e-test,benchmark}/`: import `ConnectionService`, switch controllers to resolve via `getOwnedDecrypted`. Drop the now-unused inline-credential request handling.
- All API tests updated. New e2e test in `apps/api/test/`: full create-connection-and-use-it cycle.

### Commit 3 — `refactor(web): connections via React Query, drop localStorage persist`

- New `apps/web/src/features/connections/queries.ts` per §5.1.
- Delete `apps/web/src/stores/connections-store.ts`, `connections-store.test.ts`, `apps/web/src/types/connection.ts`.
- Delete `apps/web/src/features/connections/ConnectionsImportDialog.tsx`.
- Rewrite `apps/web/src/features/connections/ConnectionsPage.tsx` and `ConnectionDialog.tsx`.
- Rewrite `apps/web/src/components/connection/EndpointPicker.tsx`.
- Update each call-site listed in §5.6: switch from inline-credential request body to `connectionId`-only; load metadata via `useConnection(id)`.
- Update i18n JSONs.
- Update all `.test.tsx`.

### Commit 4 — `docs: update specs for connection-owned credentials`

- Search-and-replace residual references to `apiKey` / `apiBaseUrl` in `docs/superpowers/specs/2026-04-27-connection-base-url-design.md` where they describe a frontend-stored field.
- Add a forward-pointer in that spec to this one.
- (This spec is the source of truth; predecessor spec just gets a note saying "credentials moved server-side per #37; see 2026-05-01-issue-37 spec".)

## 7. Manual smoke checklist

After commit 3 lands:

1. `pnpm -F @modeldoctor/api db:migrate:reset --force` (fresh DB).
2. `pnpm dev` → register a new user → log in.
3. `/connections` → Create dialog → paste a curl with a real API key → Save.
4. Inspect Postgres: `select api_key_cipher from connections;` → confirm value starts with `v1:` and is not the plaintext.
5. `/connections` list → API Key column shows `sk-...abcd` style preview only.
6. `/playground/chat` → select the connection → send a message → verify it works end-to-end.
7. Open browser DevTools → Network tab → re-send the message → inspect the request body to `/api/playground/chat` → confirm `connectionId` is present and `apiKey` is absent.
8. `/load-test` → select connection → start a small load test → confirm vegeta hits upstream successfully; same Network panel check.
9. `/benchmarks` → Add → select connection → Throughput preset → confirm guidellm runs end-to-end. Network panel: `connectionId` only.
10. `/e2e` → text/image/audio probes → confirm all three pass.
11. DevTools → Application → Local Storage → confirm no `modeldoctor-connections` key exists; the persisted connections slice is gone.
12. `/connections` → Edit a connection → toggle "Reset API key" off → save (only changes name) → confirm cipher in DB is unchanged.
13. `/connections` → Edit again → toggle "Reset API key" on → enter new key → save → confirm cipher in DB has changed; `/playground/chat` still works.
14. `/connections` → Delete a connection that a benchmark Run referenced → verify Run row's `connectionId` is now NULL (Postgres `select connection_id from runs where id = '…'`).
15. Multi-user check: register second user → verify `/connections` returns empty list (RBAC isolation); attempt `GET /api/connections/<other-user-id>` via curl → 403.

If all 15 pass: the migration is end-to-end clean. PR ready for review.

## 8. Risks

1. **List path decrypts every cipher to compute preview.** N (per-user) is small; acceptable. If profiling later shows hotspots, add a denormalized `api_key_preview` column written at create/update time and skip runtime decryption on list. Out of scope this PR.
2. **Re-running an old Run uses current Connection's apiKey.** If user edits Connection between original run and re-run, the re-run uses the new key. Documented; acceptable. Per-run snapshot can be re-added (the column was just removed; it's the same shape as before) if real demand emerges.
3. **`CONNECTION_API_KEY_ENCRYPTION_KEY` deploy gap.** Renaming the env var means every deploy environment (dev, staging, prod, CI, docker-compose, k8s configmaps) must be updated in lockstep. A missing var fails fast at app boot with a clear error message — no silent failure mode. Mitigated by: (a) `.env.example` updated in commit 2; (b) explicit checklist item in PR description for ops; (c) merging to main is gated on user confirmation per CLAUDE.md.
4. **18+ web call-site rewrites.** Single PR diff is large. Mitigated by: (a) each call-site change is the same mechanical pattern (drop 5 fields from body, add `connectionId`); (b) each `.test.tsx` exercises the body shape via mocks, catching omissions; (c) the type-check gate means any forgotten file fails CI.
5. **`@@unique([userId, name])` collision on first user-driven create.** No historical data to migrate (per user direction), so no day-1 collisions; the constraint only matters for fresh creates. Surfaces as 409 to client; UI shows "name already taken".
6. **Plaintext apiKey in NestJS request memory.** Plaintext lives in heap from `getOwnedDecrypted` return until the upstream HTTP call completes. Standard server-side trust; not different from any other secret-handling backend. Logging filters in place (existing pattern excludes `apiKey` headers from request logs).

## 9. Open items

None. All design decisions resolved during brainstorm:

- ✅ Single backend Connection table, no parallel concept.
- ✅ `connectionId`-only on the wire; apiKey never leaves backend on the call path.
- ✅ Drop localStorage data; no auto-migration UI.
- ✅ EndpointPicker read-only after pick; "edit this connection" / "save as new" entry points.
- ✅ Drop `apiType` / `prometheusUrl` / `serverKind` from Connection.
- ✅ Single PR, four logical commits.
- ✅ Env var renamed `CONNECTION_API_KEY_ENCRYPTION_KEY`.
- ✅ All historical data wiped (DB reset + zustand persist version drop).
- ✅ `apiKeyPreview` = first 3 + last 4 chars of plaintext.
- ✅ No "show plaintext once" UI; `ConnectionWithSecret.apiKey` returned but unused by UI.
- ✅ `customHeaders` / `queryParams` remain raw strings (no double-serialization).
- ✅ `ConnectionsImportDialog` removed; cross-machine portability deferred.
