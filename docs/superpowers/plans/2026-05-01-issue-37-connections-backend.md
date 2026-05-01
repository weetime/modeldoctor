# Issue #37 — Connections Backend Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `connections` from browser localStorage to backend storage with encrypted-at-rest API keys; eliminate plaintext apiKey from the wire on every test invocation.

**Architecture:** Single backend `Connection` table owns credentials (AES-256-GCM at rest). Test endpoints (`/api/playground/*`, `/api/load-test/*`, `/api/e2e/*`, `/api/benchmark/*`) accept `connectionId` only and resolve plaintext server-side via `ConnectionService.getOwnedDecrypted`. Web layer replaces zustand-persist with React Query.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL, Zod, AES-256-GCM (Node `crypto`), React 18, React Query 5, zustand 4, Vitest 1/2.

**Spec:** `docs/superpowers/specs/2026-05-01-issue-37-connections-backend-design.md`

---

## Phase 1 — Contracts

### Task 1.1: Rewrite `packages/contracts/src/connection.ts`

**Files:**
- Modify: `packages/contracts/src/connection.ts`

- [ ] **Step 1: Replace file contents**

```ts
import { z } from "zod";
import { modalityCategorySchema } from "./modality.js";

/** What clients see on list / detail. No plaintext apiKey, only preview. */
export const connectionPublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKeyPreview: z.string(),
  model: z.string().min(1),
  customHeaders: z.string(),
  queryParams: z.string(),
  category: modalityCategorySchema,
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConnectionPublic = z.infer<typeof connectionPublicSchema>;

/** Returned exactly once by POST /api/connections, and by PATCH when apiKey is rotated. */
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

- [ ] **Step 2: Update `packages/contracts/src/index.ts` re-exports**

Open the file. Remove any `export … connectionApiTypeSchema|ConnectionApiType|serverKindSchema|ServerKind` lines. The remaining `connection` exports (Connection / CreateConnection / etc.) keep working since names (re-shaped) still exist.

- [ ] **Step 3: Build the contracts package and observe expected type errors elsewhere**

Run: `pnpm -F @modeldoctor/contracts build`
Expected: PASS (contracts is self-contained).

Run: `pnpm -F @modeldoctor/api type-check`
Expected: FAIL (api still references old `connectionApiType`, `serverKind`, `Connection.apiType`, etc.). That's expected — fixed in later tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/connection.ts packages/contracts/src/index.ts
git commit -m "refactor(contracts): rewrite Connection schema for backend-stored credentials

Drop apiType/serverKind/prometheusUrl. Add apiKeyCipher-backed apiKey,
model, customHeaders, queryParams, category, tags. Public response
returns apiKeyPreview only; ConnectionWithSecret returns plaintext
apiKey once on create / apiKey rotation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Drop credential fields from playground request schemas

**Files:**
- Modify: `packages/contracts/src/playground.ts`

- [ ] **Step 1: Replace each `Playground*RequestSchema`**

For each of these schemas, drop `apiBaseUrl, apiKey, model, customHeaders, queryParams` (when present) and add `connectionId: z.string()` as the first field. Keep all other fields verbatim. Schemas to update (verified against current code):

- `PlaygroundChatRequestSchema` — keep `pathOverride`, `messages`, `params`
- `PlaygroundEmbeddingsRequestSchema` — keep `pathOverride`, `input`, `dimensions` etc.
- `PlaygroundRerankRequestSchema` — keep `pathOverride`, `query`, `documents`, `topN`
- `PlaygroundImagesRequestSchema` — keep `pathOverride`, `prompt`, `n`, `size`, `responseFormat`
- `PlaygroundImagesEditMultipartFieldsSchema` — drop credential fields, add `connectionId`
- `PlaygroundTtsRequestSchema` — keep `pathOverride`, `input`, `voice`, `format` etc.
- `PlaygroundTranscriptionsBodySchema` — drop credential fields, add `connectionId`

Example for `PlaygroundChatRequestSchema`:

```ts
export const PlaygroundChatRequestSchema = z.object({
  connectionId: z.string().min(1),
  /** Override the default `/v1/chat/completions` path tail. */
  pathOverride: z.string().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  params: ChatParamsSchema.default({}),
});
```

Apply the analogous transform to each schema listed above. Read each schema first, replace credentials with `connectionId`, leave everything else untouched.

- [ ] **Step 2: Verify the contracts package still type-checks**

Run: `pnpm -F @modeldoctor/contracts type-check`
Expected: PASS.

- [ ] **Step 3: Run contracts tests**

Run: `pnpm -F @modeldoctor/contracts test`
Expected: existing schema tests for playground requests will FAIL (they assert presence of `apiBaseUrl` / `apiKey`). Note which tests fail; they are updated in Step 4.

- [ ] **Step 4: Update playground request schema tests**

For each failing test in `packages/contracts/src/playground.spec.ts` (or wherever — search): replace fixture values' `apiBaseUrl/apiKey/model/customHeaders/queryParams` with `connectionId: "conn_test_id"`. Keep all other assertions (e.g. on `messages`, `params`, `pathOverride`).

Run: `pnpm -F @modeldoctor/contracts test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/playground.ts packages/contracts/src/playground.spec.ts
git commit -m "refactor(contracts): playground requests carry connectionId, drop credentials

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Drop credential fields from `LoadTestRequestSchema`

**Files:**
- Modify: `packages/contracts/src/load-test.ts`

- [ ] **Step 1: Update `LoadTestRequestSchema`**

Read the current schema. Remove fields `apiBaseUrl, apiKey, model, customHeaders, queryParams` if present. Add `connectionId: z.string().min(1)`. Keep `apiType` (per `2026-04-27` spec, apiType is per-test). Keep all other fields (rate, duration, etc.).

- [ ] **Step 2: Update load-test schema tests**

In `packages/contracts/src/load-test.spec.ts` (or equivalent), replace credential fixture fields with `connectionId: "conn_test"`.

- [ ] **Step 3: Run tests and verify**

Run: `pnpm -F @modeldoctor/contracts test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/load-test.ts packages/contracts/src/load-test.spec.ts
git commit -m "refactor(contracts): load-test request carries connectionId, drop credentials

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: Drop credential fields from `E2ETestRequestSchema`

**Files:**
- Modify: `packages/contracts/src/e2e-test.ts`

- [ ] **Step 1: Update schema** — remove `apiBaseUrl/apiKey/model/customHeaders/queryParams`, add `connectionId: z.string().min(1)`. Keep `probeIds` and any other domain fields.

- [ ] **Step 2: Update tests** — replace credential fixtures with `connectionId`.

- [ ] **Step 3: Verify**

Run: `pnpm -F @modeldoctor/contracts test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/e2e-test.ts packages/contracts/src/e2e-test.spec.ts
git commit -m "refactor(contracts): e2e request carries connectionId, drop credentials

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.5: Drop credential fields from `CreateBenchmarkRequestSchema`

**Files:**
- Modify: `packages/contracts/src/benchmark.ts`

- [ ] **Step 1: Update schema** — remove credential fields, add `connectionId: z.string().min(1)`. Keep `apiType`, mode, scenario, and other domain fields.

- [ ] **Step 2: Drop `apiKeyCipher` from `BenchmarkRunSchema` / `BenchmarkRunSummarySchema`** if those schemas reference it.

- [ ] **Step 3: Update tests**

In `packages/contracts/src/benchmark.spec.ts`: replace credential fixtures with `connectionId`. Drop `apiKeyCipher` from any Run-shape fixtures.

- [ ] **Step 4: Verify**

Run: `pnpm -F @modeldoctor/contracts test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/benchmark.ts packages/contracts/src/benchmark.spec.ts
git commit -m "refactor(contracts): benchmark request carries connectionId, drop credentials

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.6: Drop `apiKeyCipher` from `runSchema`

**Files:**
- Modify: `packages/contracts/src/run.ts`

- [ ] **Step 1: Remove `apiKeyCipher`** from `runSchema` if present (it was the per-run snapshot; we're removing it).

- [ ] **Step 2: Update any tests asserting `apiKeyCipher` presence in run rows.**

- [ ] **Step 3: Verify**

Run: `pnpm -F @modeldoctor/contracts test && pnpm -F @modeldoctor/contracts build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/run.ts packages/contracts/src/run.spec.ts
git commit -m "refactor(contracts): drop apiKeyCipher from runSchema

Per-run apiKey snapshots are removed; runs reference Connection via
connectionId and the current Connection's apiKey is decrypted at call
time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Backend schema, env, encryption

### Task 2.1: Rewrite Prisma `Connection` model + drop `Run.apiKeyCipher`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Replace the `Connection` model**

```prisma
model Connection {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  name          String
  baseUrl       String   @map("base_url")
  apiKeyCipher  String   @map("api_key_cipher")
  model         String
  customHeaders String   @default("") @map("custom_headers")
  queryParams   String   @default("") @map("query_params")
  category      String
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

- [ ] **Step 2: Remove `apiKeyCipher` from `Run`**

Find `apiKeyCipher String? @map("api_key_cipher")` in the `Run` model and delete that line.

- [ ] **Step 3: Generate migration**

Run: `pnpm -F @modeldoctor/api prisma migrate dev --name connections_credentials_refactor`
Expected: Prisma generates a new migration directory under `apps/api/prisma/migrations/` with up SQL: DROP COLUMN `connections.api_type`, `prometheus_url`, `server_kind`; ADD COLUMN `connections.api_key_cipher`, `model`, `custom_headers`, `query_params`, `category`, `tags`; ADD UNIQUE `(user_id, name)`; DROP COLUMN `runs.api_key_cipher`. Postgres may warn about NOT NULL adds without default — Prisma's flow will prompt to reset; accept reset.

If reset prompt: type `y` to confirm. The dev DB is wiped; existing dev rows are lost (per spec).

- [ ] **Step 4: Verify the new migration is valid**

Run: `pnpm -F @modeldoctor/api prisma migrate status`
Expected: "Database schema is up to date".

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "refactor(api/db): Connection owns credentials; drop Run.apiKeyCipher

Connection schema rewritten: drops apiType/prometheusUrl/serverKind,
adds apiKeyCipher/model/customHeaders/queryParams/category/tags, and
adds @@unique([userId, name]). Run.apiKeyCipher removed; rerun flows
read the current Connection's apiKey.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: Rename env var `BENCHMARK_API_KEY_ENCRYPTION_KEY` → `CONNECTION_API_KEY_ENCRYPTION_KEY`

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/env.spec.ts`
- Modify: `.env.example`
- Modify: `deploy/**` (search for the old name)

- [ ] **Step 1: Search-and-replace across the repo**

Run: `git grep -l 'BENCHMARK_API_KEY_ENCRYPTION_KEY'`
Expected: a list of files (env schema, env spec, `.env.example`, possibly k8s configmaps in `deploy/`).

For each file, replace every occurrence `BENCHMARK_API_KEY_ENCRYPTION_KEY` → `CONNECTION_API_KEY_ENCRYPTION_KEY`. Use exact-string replacement, not regex.

- [ ] **Step 2: Verify nothing references the old name**

Run: `git grep 'BENCHMARK_API_KEY_ENCRYPTION_KEY'`
Expected: zero matches.

- [ ] **Step 3: Run env tests**

Run: `pnpm -F @modeldoctor/api test src/config/env.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config/ .env.example deploy/
git commit -m "refactor(api/config): rename env var to CONNECTION_API_KEY_ENCRYPTION_KEY

Reflects new ownership: encryption is no longer benchmark-specific —
Connection table now owns credentials for all upstream calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: Update `BenchmarkService` to drop direct cipher use

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

Context: today the benchmark service encrypts `req.apiKey` and stores the cipher on `Run`. We are removing that — the Connection table owns the cipher; benchmark resolves via `getOwnedDecrypted`. Implementation of `getOwnedDecrypted` lands in Task 2.5; for now we just delete the now-stale code paths so the type-check is clean.

- [ ] **Step 1: Remove `apiKeyCipher` write/read in `benchmark.service.ts`**

Search for lines: `const cipher = encrypt(req.apiKey, this.key);`, `apiKeyCipher: cipher`, `if (!row.apiKeyCipher)`, `decrypt(row.apiKeyCipher, this.key)`. Delete them.

The service will now have a temporary type error: `req.apiKey` no longer exists on the request. The full re-wire happens in Task 2.6. To keep this commit green, leave a placeholder comment `// TODO(connections): switch to ConnectionService.getOwnedDecrypted in Task 2.6` and stub `apiKey = "STUB"` for the upstream-call construction (this stub is replaced in Task 2.6 — type-check passes, runtime tests covered by 2.6).

Actually — rather than a stub, fold this cleanup into Task 2.6 (where ConnectionService is wired). Skip this task if the stub feels error-prone.

> **Decision:** SKIP Task 2.3. The cleanup happens atomically in Task 2.6 alongside the rewire. Move to Task 2.4.

---

### Task 2.4: TDD — write `ConnectionService` tests for the new behavior

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.spec.ts`

- [ ] **Step 1: Replace the spec file with the new test set**

```ts
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Connection as PrismaConnection } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConnectionService } from "./connection.service.js";
import { PrismaService } from "../../database/prisma.service.js";
import { decrypt } from "../../common/crypto/aes-gcm.js";

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
  };
}

function makeRow(overrides: Partial<PrismaConnection> = {}): PrismaConnection {
  return {
    id: "c_1",
    userId: "u_1",
    name: "vllm-prod",
    baseUrl: "http://10.x.x.x:30888",
    apiKeyCipher: "v1:placeholder",
    model: "qwen2.5",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
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
    service = await makeService(prismaMock);
  });

  describe("create", () => {
    it("encrypts apiKey, stores cipher, returns ConnectionWithSecret containing plaintext once", async () => {
      const PLAINTEXT = "sk-secret-12345";
      let storedCipher = "";
      prismaMock.connection.create.mockImplementation(async (args: { data: { apiKeyCipher: string } & Record<string, unknown> }) => {
        storedCipher = args.data.apiKeyCipher;
        return makeRow({ apiKeyCipher: storedCipher });
      });
      const out = await service.create("u_1", {
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
      prismaMock.connection.update.mockImplementation(async (args: { data: { apiKeyCipher?: string } }) => {
        newCipher = args.data.apiKeyCipher!;
        return makeRow({ apiKeyCipher: newCipher });
      });
      const out = await service.update("u_1", "c_1", { apiKey: "sk-new-5678" });
      expect("apiKey" in out).toBe(true);
      expect((out as { apiKey: string }).apiKey).toBe("sk-new-5678");
      expect(newCipher).toMatch(/^v1:/);
      expect(newCipher).not.toBe(oldCipher);
    });
    it("returns ConnectionPublic (no plaintext) when apiKey is not rotated", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      prismaMock.connection.update.mockResolvedValue(makeRow({ apiKeyCipher: cipher, name: "renamed" }));
      const out = await service.update("u_1", "c_1", { name: "renamed" });
      expect("apiKey" in out).toBe(false);
      expect(out.name).toBe("renamed");
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
});

// Helper using the same key + algorithm as the production service.
async function encryptForTest(plaintext: string): Promise<string> {
  const { encrypt, decodeKey } = await import("../../common/crypto/aes-gcm.js");
  return encrypt(plaintext, decodeKey(KEY_B64));
}
```

- [ ] **Step 2: Run the spec — expect compilation/runtime failures**

Run: `pnpm -F @modeldoctor/api test src/modules/connection/connection.service.spec.ts`
Expected: FAIL — methods like `findOwnedPublic`, `getOwnedDecrypted`, `apiKeyPreview` don't exist yet on the current service.

---

### Task 2.5: Implement `ConnectionService` (rewrite)

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.ts`

- [ ] **Step 1: Replace file contents**

```ts
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  ConnectionPublic,
  ConnectionWithSecret,
  CreateConnection,
  ListConnectionsResponse,
  UpdateConnection,
  ModalityCategory,
} from "@modeldoctor/contracts";
import type { Connection as PrismaConnection, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";

export interface DecryptedConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  category: ModalityCategory;
}

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
    return this.toContractWithSecret(row, input.apiKey);
  }

  async list(userId: string): Promise<ListConnectionsResponse> {
    const rows = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: rows.map((r) => this.toContractPublic(r)),
    };
  }

  async findOwnedPublic(userId: string, id: string): Promise<ConnectionPublic> {
    const row = await this.findOwnedRow(userId, id);
    return this.toContractPublic(row);
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
      return this.toContractWithSecret(row, input.apiKey);
    }
    return this.toContractPublic(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwnedRow(userId, id);
    await this.prisma.connection.delete({ where: { id } });
  }

  /**
   * INTERNAL — not exposed via HTTP. Used by playground/load-test/e2e/benchmark
   * services to obtain decrypted credentials for an upstream call.
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

  private toContractPublic(row: PrismaConnection): ConnectionPublic {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKeyPreview: this.makePreview(decrypt(row.apiKeyCipher, this.key)),
      model: row.model,
      customHeaders: row.customHeaders,
      queryParams: row.queryParams,
      category: row.category as ModalityCategory,
      tags: row.tags,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toContractWithSecret(
    row: PrismaConnection,
    plaintext: string,
  ): ConnectionWithSecret {
    return {
      ...this.toContractPublic(row),
      apiKey: plaintext,
    };
  }

  private makePreview(apiKey: string): string {
    if (apiKey.length <= 7) return apiKey;
    return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
  }
}
```

- [ ] **Step 2: Run the spec — expect PASS**

Run: `pnpm -F @modeldoctor/api test src/modules/connection/connection.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/connection/connection.service.ts apps/api/src/modules/connection/connection.service.spec.ts
git commit -m "feat(api/connection): encrypt-at-rest apiKey, getOwnedDecrypted helper

ConnectionService now owns the encryption key and exposes:
 - create/update with plaintext apiKey input → AES-256-GCM cipher in DB
 - list/findOwnedPublic returning apiKeyPreview only
 - getOwnedDecrypted(userId, id) for in-process use by upstream callers

Cross-user access on any read raises ForbiddenException.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.6: Rewrite `ConnectionController` for the new shape

**Files:**
- Modify: `apps/api/src/modules/connection/connection.controller.ts`
- Modify: `apps/api/src/modules/connection/connection.controller.spec.ts`
- Modify: `apps/api/src/modules/connection/connection.module.ts`

- [ ] **Step 1: Replace `connection.controller.ts`**

```ts
import {
  type ConnectionPublic,
  type ConnectionWithSecret,
  type CreateConnection,
  type ListConnectionsResponse,
  type UpdateConnection,
  createConnectionSchema,
  updateConnectionSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "./connection.service.js";

@Controller("connections")
@UseGuards(JwtAuthGuard)
export class ConnectionController {
  constructor(private readonly service: ConnectionService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListConnectionsResponse> {
    return this.service.list(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createConnectionSchema)) body: CreateConnection,
  ): Promise<ConnectionWithSecret> {
    return this.service.create(user.sub, body);
  }

  @Get(":id")
  detail(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<ConnectionPublic> {
    return this.service.findOwnedPublic(user.sub, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateConnectionSchema)) body: UpdateConnection,
  ): Promise<ConnectionWithSecret | ConnectionPublic> {
    return this.service.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
```

- [ ] **Step 2: Update controller spec**

In `connection.controller.spec.ts`: rewrite the existing tests to mock `ConnectionService` directly (its methods now return the new shapes). Cover happy paths for the 5 routes and a 403/404 case via thrown exceptions from the service mock.

- [ ] **Step 3: Update `connection.module.ts`**

Make sure `ConnectionService` is in `exports`:

```ts
@Module({
  controllers: [ConnectionController],
  providers: [ConnectionService],
  exports: [ConnectionService],
})
export class ConnectionModule {}
```

- [ ] **Step 4: Run module tests**

Run: `pnpm -F @modeldoctor/api test src/modules/connection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/
git commit -m "refactor(api/connection): controller + module wired to new service shape

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Backend caller rewrites

### Task 3.1: Rewrite `playground` services + controller to take `connectionId`

**Files:**
- Modify: `apps/api/src/modules/playground/playground.module.ts`
- Modify: `apps/api/src/modules/playground/*.controller.ts` and `*.service.ts` (chat, embeddings, rerank, image, audio etc.)
- Modify: `apps/api/src/modules/playground/*.spec.ts`

- [ ] **Step 1: Add `ConnectionModule` to `PlaygroundModule.imports`**

```ts
@Module({
  imports: [ConnectionModule],
  controllers: [...],
  providers: [...],
})
export class PlaygroundModule {}
```

- [ ] **Step 2: For each playground service file, change the request handler**

Pattern for `chat.service.ts` (and analogous in `embeddings.service.ts`, `rerank.service.ts`, `image.service.ts`, `audio.service.ts` / tts / stt):

```ts
// before: receives req with apiBaseUrl/apiKey/model/customHeaders/queryParams
async chat(req: PlaygroundChatRequest, userId: string): Promise<PlaygroundChatResponse> {
  // ...
  const headers = buildHeaders(req.apiKey, req.customHeaders);
  // ...
}

// after: takes a DecryptedConnection alongside the (now thinner) req
async chat(
  conn: DecryptedConnection,
  req: PlaygroundChatRequest,
): Promise<PlaygroundChatResponse> {
  const headers = buildHeaders(conn.apiKey, conn.customHeaders);
  const url = buildUrl({
    baseUrl: conn.baseUrl,
    pathTail: req.pathOverride ?? "/v1/chat/completions",
    queryParams: conn.queryParams,
  });
  // body: same shape as before but uses conn.model where it used req.model
}
```

- [ ] **Step 3: Update each controller to fetch `DecryptedConnection` and pass it through**

```ts
@Post("chat")
@UseGuards(JwtAuthGuard)
async chat(
  @CurrentUser() user: JwtPayload,
  @Body(new ZodValidationPipe(PlaygroundChatRequestSchema)) body: PlaygroundChatRequest,
): Promise<PlaygroundChatResponse> {
  const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
  return this.chatService.chat(conn, body);
}
```

(Inject `ConnectionService` via constructor on each playground controller.)

- [ ] **Step 4: Update each service spec**

For each `*.service.spec.ts`: change fixtures to provide a `DecryptedConnection` argument plus the trimmed `req` body. Assertions on outgoing HTTP headers / URLs continue to pass since the values flow through the same code paths, just sourced differently.

- [ ] **Step 5: Run playground tests**

Run: `pnpm -F @modeldoctor/api test src/modules/playground`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/playground/
git commit -m "refactor(api/playground): resolve credentials via ConnectionService

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: Rewrite `load-test` to take `connectionId`

**Files:**
- Modify: `apps/api/src/modules/load-test/load-test.module.ts`
- Modify: `apps/api/src/modules/load-test/load-test.controller.ts`
- Modify: `apps/api/src/modules/load-test/load-test.service.ts`
- Modify: `apps/api/src/modules/load-test/load-test.service.spec.ts`

- [ ] **Step 1: Add `ConnectionModule` to imports**

- [ ] **Step 2: Controller resolves `DecryptedConnection`**

```ts
@Post("start")
@UseGuards(JwtAuthGuard)
async start(
  @CurrentUser() user: JwtPayload,
  @Body(new ZodValidationPipe(LoadTestRequestSchema)) body: LoadTestRequest,
) {
  const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
  return this.service.start(user.sub, conn, body);
}
```

- [ ] **Step 3: `service.start` constructs final URL via `loadTestApiTypePath`**

```ts
async start(userId: string, conn: DecryptedConnection, req: LoadTestRequest) {
  const finalUrl = `${conn.baseUrl}${loadTestApiTypePath(req.apiType)}`;
  const apiKey = conn.apiKey;
  // headers from conn.customHeaders + apiKey
  // queryParams from conn.queryParams
  // ...spawn vegeta as before
}
```

- [ ] **Step 4: Update spec — fixtures pass `conn` parameter**

- [ ] **Step 5: Run tests**

Run: `pnpm -F @modeldoctor/api test src/modules/load-test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/load-test/
git commit -m "refactor(api/load-test): resolve credentials via ConnectionService

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3: Rewrite `e2e-test` to take `connectionId`

**Files:**
- Modify: `apps/api/src/modules/e2e-test/e2e-test.module.ts`
- Modify: `apps/api/src/modules/e2e-test/e2e-test.controller.ts`
- Modify: `apps/api/src/modules/e2e-test/e2e-test.service.ts`
- Modify: `apps/api/src/modules/e2e-test/e2e-test.service.spec.ts`

- [ ] **Step 1: Add `ConnectionModule` to imports**

- [ ] **Step 2: Controller resolves `DecryptedConnection`**

- [ ] **Step 3: `E2ETestService.run` constructs `ProbeCtx` from `conn`**

```ts
async run(userId: string, conn: DecryptedConnection, req: E2ETestRequest) {
  const ctx: ProbeCtx = {
    apiBaseUrl: conn.baseUrl,
    apiKey: conn.apiKey,
    model: conn.model,
    extraHeaders: parseHeaderLines(conn.customHeaders),
  };
  // ...iterate req.probeIds, run each probe with ctx
}
```

- [ ] **Step 4: Update spec — pass `conn` fixture**

- [ ] **Step 5: Run tests**

Run: `pnpm -F @modeldoctor/api test src/modules/e2e-test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/e2e-test/
git commit -m "refactor(api/e2e-test): resolve credentials via ConnectionService

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.4: Rewrite `benchmark` to take `connectionId` and drop per-run cipher

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.module.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.controller.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`
- Modify: `apps/api/src/modules/benchmark/drivers/*.ts` and `*.spec.ts` (subprocess + k8s)

- [ ] **Step 1: Add `ConnectionModule` to imports**

- [ ] **Step 2: Controller resolves `DecryptedConnection`**

```ts
@Post()
@UseGuards(JwtAuthGuard)
async create(
  @CurrentUser() user: JwtPayload,
  @Body(new ZodValidationPipe(CreateBenchmarkRequestSchema)) body: CreateBenchmarkRequest,
) {
  const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
  return this.service.create(user.sub, conn, body);
}
```

- [ ] **Step 3: `BenchmarkService.create` & `start` use `conn` directly**

Remove: the `encrypt(req.apiKey, this.key)` call, the `apiKeyCipher` write to `Run`, the later `decrypt(row.apiKeyCipher, …)` read. The decrypted apiKey now flows from `conn.apiKey` directly into the `BenchmarkExecutionContext` used by drivers. (`BenchmarkExecutionContext` interface unchanged.)

`Run` row: still write `connectionId: conn.id`, drop `apiKeyCipher` field from the create-data block.

`start` (which today re-decrypts from the row): change to `await this.connections.getOwnedDecrypted(row.userId, row.connectionId)` and use the result. This keeps the "submit now, start later" flow working since the apiKey is fetched fresh from the Connection at start time.

Edge case: if `row.connectionId === null` (because the user deleted the connection between create and start), throw a meaningful error — `BadRequestException("Connection no longer exists")`.

- [ ] **Step 4: `BenchmarkService` no longer needs `key`/`encrypt`/`decrypt`**

Remove constructor's `decodeKey` / `key` field; remove `encrypt`/`decrypt` imports.

- [ ] **Step 5: Update specs**

- `benchmark.service.spec.ts`: fixtures + assertions drop `apiKeyCipher`; tests now mock `ConnectionService.getOwnedDecrypted`.
- Driver specs (`subprocess-driver.spec.ts`, `k8s-job-manifest.spec.ts`): no change to driver internals; only fixture's `BenchmarkExecutionContext` populated from the new flow.

- [ ] **Step 6: Run benchmark tests**

Run: `pnpm -F @modeldoctor/api test src/modules/benchmark`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/benchmark/
git commit -m "refactor(api/benchmark): resolve credentials via ConnectionService at start time

Drops Run.apiKeyCipher snapshot. Re-runs use the current Connection's
apiKey, refetched at job-start time. If the source Connection was
deleted, start fails with BadRequestException.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.5: API-level e2e test — create-and-use connection cycle

**Files:**
- Create: `apps/api/test/connection-lifecycle.e2e-spec.ts`

- [ ] **Step 1: Write the e2e test**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module.js";

describe("Connection lifecycle (e2e)", () => {
  let app: INestApplication;
  let bearer: string;
  let connId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    // Register + login to get a bearer
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "conn-e2e@example.com", password: "PasswordPassword1!" });
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "conn-e2e@example.com", password: "PasswordPassword1!" });
    bearer = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a connection, returns plaintext once, lists with preview only", async () => {
    const create = await request(app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${bearer}`)
      .send({
        name: "e2e-test-conn",
        baseUrl: "http://localhost:9999",
        apiKey: "sk-e2etest1234",
        model: "test-model",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
      });
    expect(create.status).toBe(201);
    expect(create.body.apiKey).toBe("sk-e2etest1234");
    expect(create.body.apiKeyPreview).toBe("sk-...1234");
    connId = create.body.id;

    const list = await request(app.getHttpServer())
      .get("/api/connections")
      .set("Authorization", `Bearer ${bearer}`);
    expect(list.status).toBe(200);
    const item = list.body.items.find((c: { id: string }) => c.id === connId);
    expect(item).toBeDefined();
    expect(item.apiKey).toBeUndefined();
    expect(item.apiKeyPreview).toBe("sk-...1234");
  });

  it("rejects cross-user access with 403", async () => {
    // Register a second user
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "other@example.com", password: "PasswordPassword1!" });
    const login2 = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "other@example.com", password: "PasswordPassword1!" });
    const otherBearer = login2.body.accessToken;

    const res = await request(app.getHttpServer())
      .get(`/api/connections/${connId}`)
      .set("Authorization", `Bearer ${otherBearer}`);
    expect(res.status).toBe(403);
  });

  it("deletes the connection", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/connections/${connId}`)
      .set("Authorization", `Bearer ${bearer}`);
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run the e2e test against a clean test DB**

Run: `pnpm -F @modeldoctor/api test:e2e test/connection-lifecycle.e2e-spec.ts`
Expected: PASS. (If env requires a live DB or `BENCHMARK_API_KEY_ENCRYPTION_KEY` historically — make sure `CONNECTION_API_KEY_ENCRYPTION_KEY` is set in `.env.test` per Task 2.2.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/connection-lifecycle.e2e-spec.ts
git commit -m "test(api/e2e): connection lifecycle covers create / list / RBAC / delete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.6: Full API verification gate

- [ ] **Step 1: Run the full API test suite**

Run: `pnpm -F @modeldoctor/api test`
Expected: PASS.

Run: `pnpm -F @modeldoctor/api type-check`
Expected: PASS.

Run: `pnpm -F @modeldoctor/api lint`
Expected: PASS.

If anything fails: stop, fix, re-run, then proceed. Do NOT continue to Phase 4 with a red API.

---

## Phase 4 — Web foundation

### Task 4.1: Add `patch` helper to `api`

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/api-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// In api-client.test.ts, new describe block:
describe("api.patch", () => {
  it("issues a PATCH with JSON body and parses the response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const out = await api.patch<{ ok: boolean }>("/api/x", { foo: 1 });
    expect(out).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith("/api/x", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ foo: 1 }),
    }));
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/web test src/lib/api-client.test.ts`
Expected: FAIL — `api.patch is not a function`.

- [ ] **Step 3: Add `patch` to `api`**

In `apps/web/src/lib/api-client.ts`, extend the `api` export:

```ts
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
```

(Verify `request` already sets `Content-Type: application/json` for bodied methods; if not, set it here.)

- [ ] **Step 4: Run test, expect PASS**

Run: `pnpm -F @modeldoctor/web test src/lib/api-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts
git commit -m "feat(web/api-client): add api.patch helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.2: Create connections React Query layer + tests

**Files:**
- Create: `apps/web/src/features/connections/queries.ts`
- Create: `apps/web/src/features/connections/queries.test.tsx`

- [ ] **Step 1: Write tests first**

```tsx
// queries.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useConnections, useConnection, useCreateConnection, useDeleteConnection, useUpdateConnection } from "./queries";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useConnections", () => {
  beforeEach(() => vi.clearAllMocks());
  it("fetches list and exposes items", async () => {
    (api.get as any).mockResolvedValue({ items: [{ id: "c1", name: "n", apiKeyPreview: "sk-...1234" }] });
    const { result } = renderHook(() => useConnections(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "c1", name: "n", apiKeyPreview: "sk-...1234" }]);
    expect(api.get).toHaveBeenCalledWith("/api/connections");
  });
});

describe("useConnection", () => {
  beforeEach(() => vi.clearAllMocks());
  it("is disabled when id is null", () => {
    const { result } = renderHook(() => useConnection(null), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
  it("fetches the detail when id is set", async () => {
    (api.get as any).mockResolvedValue({ id: "c1", name: "n" });
    const { result } = renderHook(() => useConnection("c1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/connections/c1");
  });
});

describe("useCreateConnection", () => {
  beforeEach(() => vi.clearAllMocks());
  it("posts the body and returns ConnectionWithSecret", async () => {
    (api.post as any).mockResolvedValue({ id: "c1", apiKey: "sk-x" });
    const { result } = renderHook(() => useCreateConnection(), { wrapper: wrap() });
    await result.current.mutateAsync({ name: "n", baseUrl: "http://x", apiKey: "sk-x", model: "m", customHeaders: "", queryParams: "", category: "chat", tags: [] });
    expect(api.post).toHaveBeenCalledWith("/api/connections", expect.objectContaining({ apiKey: "sk-x" }));
  });
});

describe("useUpdateConnection", () => {
  beforeEach(() => vi.clearAllMocks());
  it("patches the row by id", async () => {
    (api.patch as any).mockResolvedValue({ id: "c1" });
    const { result } = renderHook(() => useUpdateConnection(), { wrapper: wrap() });
    await result.current.mutateAsync({ id: "c1", body: { name: "renamed" } });
    expect(api.patch).toHaveBeenCalledWith("/api/connections/c1", { name: "renamed" });
  });
});

describe("useDeleteConnection", () => {
  beforeEach(() => vi.clearAllMocks());
  it("deletes by id", async () => {
    (api.del as any).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteConnection(), { wrapper: wrap() });
    await result.current.mutateAsync("c1");
    expect(api.del).toHaveBeenCalledWith("/api/connections/c1");
  });
});
```

- [ ] **Step 2: Verify the tests fail (file doesn't exist)**

Run: `pnpm -F @modeldoctor/web test src/features/connections/queries.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `queries.ts`**

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

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @modeldoctor/web test src/features/connections/queries.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/connections/queries.ts apps/web/src/features/connections/queries.test.tsx
git commit -m "feat(web/connections): React Query hooks for connection CRUD

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Web cleanup + UI rewrite

### Task 5.1: Delete `useConnectionsStore` and old types

**Files:**
- Delete: `apps/web/src/stores/connections-store.ts`
- Delete: `apps/web/src/stores/connections-store.test.ts`
- Delete: `apps/web/src/types/connection.ts`

> **Caution:** This will break compilation across the web app. The breakage is fixed in Tasks 5.2–5.7 below. Do not commit until that whole phase is green. Stage-only here; final commit is in Task 5.7.

- [ ] **Step 1: Delete the three files**

```bash
git rm apps/web/src/stores/connections-store.ts apps/web/src/stores/connections-store.test.ts apps/web/src/types/connection.ts
```

- [ ] **Step 2: Search for and prepare to fix imports**

Run: `git grep -l '@/stores/connections-store\|@/types/connection'`
Expected: list of files (~18 files). These are fixed in subsequent tasks.

(No commit yet.)

---

### Task 5.2: Rewrite `ConnectionDialog`

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionDialog.tsx`
- Modify: `apps/web/src/features/connections/ConnectionDialog.test.tsx`

- [ ] **Step 1: Read the current `ConnectionDialog.tsx`** to identify the props shape and form fields used.

- [ ] **Step 2: Replace the file's logic**

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionPublic, CreateConnection } from "@modeldoctor/contracts";
import { useCreateConnection, useUpdateConnection } from "./queries";
import { Dialog, DialogContent, /* etc. — match existing UI primitives */ } from "@/components/ui/dialog";
// ... other UI imports kept from the prior version

type Mode = { kind: "create" } | { kind: "edit"; existing: ConnectionPublic };

export function ConnectionDialog({ open, mode, onClose }: { open: boolean; mode: Mode; onClose: () => void }) {
  const { t } = useTranslation("connections");
  const create = useCreateConnection();
  const update = useUpdateConnection();
  const [resetApiKey, setResetApiKey] = useState(mode.kind === "create");
  // form state: name, baseUrl, apiKey (only when create or resetApiKey), model, customHeaders, queryParams, category, tags

  // ... render the form with the same field set as before, with two adjustments:
  //   - In edit mode: the "API Key" input shows existing.apiKeyPreview as placeholder and is disabled
  //     unless `resetApiKey` is on (toggle right above it).
  //   - On submit (edit, no reset): omit `apiKey` from the patch body.
}
```

(Implementor: copy the existing form layout / validation; only change is wiring the mutation and the `resetApiKey` toggle.)

- [ ] **Step 3: Update test file** to mock `useCreateConnection` / `useUpdateConnection` (instead of the deleted zustand store) and assert:
  - Create mode submits a full `CreateConnection` body via `mutateAsync`.
  - Edit mode with toggle off submits `mutateAsync({ id, body: {…} })` **without** `apiKey`.
  - Edit mode with toggle on submits with `apiKey`.

- [ ] **Step 4: Run dialog tests**

Run: `pnpm -F @modeldoctor/web test src/features/connections/ConnectionDialog.test.tsx`
Expected: PASS.

(No commit yet.)

---

### Task 5.3: Rewrite `ConnectionsPage`

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionsPage.tsx`
- Modify: `apps/web/src/features/connections/ConnectionsPage.test.tsx`

- [ ] **Step 1: Replace data sourcing — `useConnections()` instead of zustand `.list()`.**

- [ ] **Step 2: Table cell for API Key shows `apiKeyPreview`** (no other key data displayed).

- [ ] **Step 3: Wire delete row action via `useDeleteConnection()`.**

- [ ] **Step 4: Add loading + error states** using existing patterns (e.g. skeleton on `isLoading`, error banner on `isError`).

- [ ] **Step 5: Update tests** to mock the queries and assert table renders preview only.

Run: `pnpm -F @modeldoctor/web test src/features/connections/ConnectionsPage.test.tsx`
Expected: PASS.

(No commit yet.)

---

### Task 5.4: Delete `ConnectionsImportDialog`

**Files:**
- Delete: `apps/web/src/features/connections/ConnectionsImportDialog.tsx`
- Delete: `apps/web/src/features/connections/ConnectionsImportDialog.test.tsx` (if present)

- [ ] **Step 1: Remove file(s)**

```bash
git rm apps/web/src/features/connections/ConnectionsImportDialog.tsx
```

- [ ] **Step 2: Remove the "Import" button on `ConnectionsPage`** that opened this dialog.

- [ ] **Step 3: Search for stragglers**

Run: `git grep ConnectionsImportDialog`
Expected: zero matches.

(No commit yet.)

---

### Task 5.5: Rewrite `EndpointPicker`

**Files:**
- Modify: `apps/web/src/components/connection/EndpointPicker.tsx`
- Create: `apps/web/src/components/connection/EndpointPicker.test.tsx` (if not present)

- [ ] **Step 1: Replace the editable form fields with read-only displays of the picked connection.**

Layout (per spec §5.5):

```tsx
<>
  <ConnectionDropdown value={selectedId} onChange={onPick} />
  {conn && (
    <ReadOnlyFields baseUrl={conn.baseUrl} apiKeyPreview={conn.apiKeyPreview} model={conn.model} … />
  )}
  <Button onClick={() => setEditOpen(true)}>{t("editThisConnection")}</Button>
  <Button onClick={() => setSaveAsOpen(true)}>{t("saveAsNewConnection")}</Button>
  {previewUrl && <PreviewLine url={previewUrl} />}
  {/* dialogs for edit / save-as that reuse ConnectionDialog */}
</>
```

`conn` comes from `useConnection(selectedId)`.

- [ ] **Step 2: Wire the "Edit this connection" button** to open `ConnectionDialog` in edit mode prefilled with `conn`.

- [ ] **Step 3: Wire "Save as new"** to open `ConnectionDialog` in create mode with current connection's fields prefilled, except `apiKey` (user must re-enter).

- [ ] **Step 4: Tests** — picking a connection populates the read-only display; clicking "edit" opens dialog in edit mode; clicking "save as" opens dialog in create mode with prefilled fields except apiKey.

Run: `pnpm -F @modeldoctor/web test src/components/connection`
Expected: PASS.

(No commit yet.)

---

### Task 5.6: Update each upstream consumer's request body

**Files (one per call site, matching spec §5.6):**

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
apps/web/src/features/load-test/LoadTestPage.tsx       (if it builds the body)
apps/web/src/features/e2e-smoke/E2ESmokePage.tsx       (if it builds the body)
```

Plus their `.test.tsx` siblings.

- [ ] **Step 1: For each file — apply this transform**

Replace:

```tsx
const conn = useConnectionsStore.getState().get(selectedConnectionId);
if (!conn) return;
const body: <RequestType> = {
  apiBaseUrl: conn.apiBaseUrl,
  apiKey: conn.apiKey,
  model: conn.model,
  customHeaders: conn.customHeaders || undefined,
  queryParams: conn.queryParams || undefined,
  /* ...biz fields untouched... */
};
```

With:

```tsx
if (!selectedConnectionId) return;
const body: <RequestType> = {
  connectionId: selectedConnectionId,
  /* ...biz fields untouched... */
};
```

If the file needs to display connection metadata (read-only), add `const { data: conn } = useConnection(selectedConnectionId);` and read `conn?.baseUrl`, `conn?.model`, `conn?.apiKeyPreview` for display only.

For "duplicate run" flows that previously copied apiKey from a Run row: drop the apiKey copy. Pre-select `selectedConnectionId = run.connectionId`. If `run.connectionId === null`, surface error message "保存的连接已被删除".

- [ ] **Step 2: For each file — update its `.test.tsx`** to mock `useConnection` / mutate the request body assertions to expect `{ connectionId, ...biz }` rather than inline credentials.

- [ ] **Step 3: After the full set is updated, type-check passes**

Run: `pnpm -F @modeldoctor/web type-check`
Expected: PASS (no remaining references to deleted `connections-store` / `types/connection`).

Run: `git grep -l '@/stores/connections-store\|@/types/connection\|useConnectionsStore'`
Expected: zero matches.

- [ ] **Step 4: Run all web tests**

Run: `pnpm -F @modeldoctor/web test`
Expected: PASS.

(No commit yet — final commit in Task 5.7.)

---

### Task 5.7: i18n keys + final web commit

**Files:**
- Modify: `apps/web/src/locales/zh-CN/connections.json`
- Modify: `apps/web/src/locales/en-US/connections.json`

- [ ] **Step 1: Add the keys listed in spec §5.7 to both locale JSONs**

zh-CN:
```json
{
  "apiKeyEncryptedNotice": "API key 已加密存储于云端",
  "resetApiKey": "重新设置 API key",
  "editThisConnection": "编辑此连接",
  "saveAsNewConnection": "另存为新连接",
  "savedConnectionMissing": "保存的连接已被删除，请选择其他连接"
}
```

en-US:
```json
{
  "apiKeyEncryptedNotice": "API key is stored encrypted on the server",
  "resetApiKey": "Reset API key",
  "editThisConnection": "Edit this connection",
  "saveAsNewConnection": "Save as new connection",
  "savedConnectionMissing": "Saved connection no longer exists"
}
```

(Merge into the existing JSON; do not overwrite other keys.)

- [ ] **Step 2: Final type-check + lint + test pass**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web lint && pnpm -F @modeldoctor/web test`
Expected: ALL PASS.

- [ ] **Step 3: Stage everything for the web phase and commit as one logical step**

```bash
git add apps/web/src/
git commit -m "refactor(web/connections): backend-stored credentials, React Query, EndpointPicker

- Delete useConnectionsStore + types/connection
- Add features/connections/queries.ts (React Query CRUD hooks)
- Rewrite ConnectionsPage / ConnectionDialog / EndpointPicker against the new shape
- Switch playground / load-test / e2e / benchmark request bodies to { connectionId, …biz }
- Display apiKeyPreview only; never store plaintext in browser memory
- Delete ConnectionsImportDialog (cross-machine portability deferred)
- Add i18n keys for new UI strings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Manual smoke + PR

### Task 6.1: Manual smoke per spec §7

- [ ] **Step 1: Reset DB**

```bash
pnpm -F @modeldoctor/api prisma migrate reset --force
```

- [ ] **Step 2: Start dev**

```bash
pnpm dev
```

(Run in a separate terminal or background.)

- [ ] **Step 3: Walk through the 15-step manual smoke checklist** in spec §7. Note any failures and fix before opening PR.

- [ ] **Step 4: After all 15 steps pass, kill the dev server.**

---

### Task 6.2: Update predecessor spec with forward pointer

**Files:**
- Modify: `docs/superpowers/specs/2026-04-27-connection-base-url-design.md`

- [ ] **Step 1: Add a note at the top of §1 (under Status)**

```
> **Update (2026-05-01):** Credentials moved server-side per #37; see
> `docs/superpowers/specs/2026-05-01-issue-37-connections-backend-design.md`.
> Field `apiBaseUrl` is now `Connection.baseUrl` (DB column `base_url`),
> and the public Connection shape no longer carries plaintext apiKey.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-27-connection-base-url-design.md
git commit -m "docs(spec): forward-pointer from base-url spec to issue #37 spec

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.3: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/connections-backend
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat: store connections in encrypted backend storage (closes #37)" --body "$(cat <<'EOF'
## Summary

Closes #37. Migrates `connections` from browser localStorage to backend
storage with AES-256-GCM at rest. apiKey never leaves the backend on
the call path — test endpoints accept `connectionId` only and resolve
plaintext server-side.

- Single Connection table owns credentials; `apiKeyPreview` (e.g.
  `sk-...abcd`) is the only key-related field clients see on list/detail.
- Plaintext apiKey returned exactly once on POST /api/connections (and
  on PATCH when the key is rotated).
- playground / load-test / e2e / benchmark request bodies replace
  `apiBaseUrl/apiKey/model/customHeaders/queryParams` with `connectionId`.
- Web layer drops zustand persist for connections; React Query owns
  in-memory cache. EndpointPicker becomes read-only after pick.

## Breaking changes (acceptable per pre-prod no-compat-shims rule)

- Env var renamed: `BENCHMARK_API_KEY_ENCRYPTION_KEY` → `CONNECTION_API_KEY_ENCRYPTION_KEY`. Update before deploy.
- Existing localStorage `modeldoctor-connections` is dropped (zustand persist version bump).
- Existing `connections` rows + `Run.api_key_cipher` column wiped via Prisma migration.
- Re-running an old Run uses the **current** Connection's apiKey (no per-run snapshot).

## Test plan

- [ ] Backend e2e (`apps/api/test/connection-lifecycle.e2e-spec.ts`) green
- [ ] All unit tests pass (`pnpm -r test`)
- [ ] Manual smoke: 15-step checklist in spec §7 walked end-to-end
- [ ] Network panel inspection on /playground/chat: no `apiKey` in request body

## References

- Spec: `docs/superpowers/specs/2026-05-01-issue-37-connections-backend-design.md`
- Plan: `docs/superpowers/plans/2026-05-01-issue-37-connections-backend.md`
- Predecessor (apiBaseUrl rename): `docs/superpowers/specs/2026-04-27-connection-base-url-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Note the PR URL** in the response so the user can review.

---

## Self-Review Notes

- **Spec coverage**: each spec section maps to phases here (§3 schema → Phase 2.1; §4.1 service → Tasks 2.4–2.5; §4.2 controller → Task 2.6; §4.3 callers → Tasks 3.1–3.4; §5 web → Phases 4–5; §7 smoke → Task 6.1).
- **Type consistency**: `DecryptedConnection` is defined once in Task 2.5 and used by all caller tasks (3.1–3.4). `ConnectionPublic` / `ConnectionWithSecret` / `CreateConnection` / `UpdateConnection` from Task 1.1 flow through API + web layers consistently.
- **Commit granularity**: 16 commits across 6 phases. Each commit is individually green (type-check + biome + vitest unit). The final PR can either keep granular commits or be squash-merged at user's discretion.
- **Risk control**: Phase 1 leaves API/web in a type-error state until Phase 2/3 land — but each contracts commit is green at the contracts package level. Phase 5 stages multiple file changes together (Tasks 5.1–5.7) since deleting `connections-store` breaks compilation across the web app; the whole phase ships as one commit.
