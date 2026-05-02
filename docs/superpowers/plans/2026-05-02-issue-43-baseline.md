# Issue #43 — Benchmark Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Baseline CRUD (create / list / delete) plus the minimum surface that makes "this Run is my reference" usable end-to-end — schema FK fix, baseline-aware Run filters / DTO, detail-page Set/Unset toggle, /history baseline filter — so #44 (Re-run) and #45 (Diff engine) have a baseline entity to point at.

**Architecture:** Backend mirrors the existing `connection` module (NestJS controller + service + module, JWT-guarded, `userId`-scoped). DB enforces immutability of a baseline's canonical Run via `onDelete: Restrict`. Run module gains two boolean filters (`isBaseline`, `referencesBaseline`) and a `baselineFor` field on the DTO so the detail page renders the toggle without a second request. Web side adds a dedicated `features/baseline/` directory (api client + react-query hooks) so the future baselines list page has a natural home; the toggle button + dialog live inside `features/history/HistoryDetailPage.tsx` until #46 takes over per the spec's cleanup obligations.

**Tech Stack:** NestJS 10, Prisma 6, vitest 2 (api), zod, React 18, TanStack react-query, react-router-dom 7, vitest 1 (web), Tailwind, shadcn/ui (`Select`, `Dialog`, `Button`, `Input`, `Textarea`).

**Branch:** `feat/benchmark-baseline` (already cut from `main`; current HEAD `69edf38` is the spec commit).

**Spec:** [`docs/superpowers/specs/2026-05-02-issue-43-baseline-design.md`](../specs/2026-05-02-issue-43-baseline-design.md)

**Worktree:** `/Users/fangyong/vllm/modeldoctor/feat-benchmark-baseline/` — all `pnpm`, `git`, `psql` commands assume cwd is this directory unless explicitly otherwise.

**DB:** `postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor` (local brew Postgres, shared across worktrees, disposable — `prisma migrate reset --force` is pre-authorized).

---

## Pre-flight

- ✅ `feat/benchmark-baseline` worktree created at `../feat-benchmark-baseline`, branched from `main` post-#69 merge (timestamptz fix is in).
- ✅ `pnpm install` ran clean.
- ✅ `.env` copied from `main/.env` (so `DATABASE_URL`, `JWT_ACCESS_SECRET`, `CONNECTION_API_KEY_ENCRYPTION_KEY` are present).
- ✅ Spec committed at `69edf38`.
- Verify before starting Task 1: `pnpm -r type-check` baseline is green.

```bash
pnpm -r type-check
```

Expected: all three packages (contracts / api / web) report 0 errors.

---

## Task 1: Contracts — `BaselineDto` + extend `RunDto` and `ListRunsQuery`

**Files:**
- Create: `packages/contracts/src/baseline.ts`
- Create: `packages/contracts/src/baseline.spec.ts`
- Modify: `packages/contracts/src/run.ts`
- Modify: `packages/contracts/src/index.ts`

This task is pure types. No runtime behavior changes. Once it lands, every later task can `import` from `@modeldoctor/contracts` without a placeholder.

### Step 1: Write the failing tests

Write `packages/contracts/src/baseline.spec.ts` with the full content below.

```ts
import { describe, expect, it } from "vitest";
import {
  baselineSchema,
  baselineSummarySchema,
  createBaselineSchema,
  listBaselinesResponseSchema,
} from "./baseline.js";

describe("baselineSchema", () => {
  it("accepts a complete row", () => {
    const ok = baselineSchema.parse({
      id: "b_1",
      userId: "u_1",
      runId: "r_1",
      name: "throughput-anchor",
      description: "first known-good qwen2.5 benchmark",
      tags: ["qwen", "throughput"],
      templateId: null,
      templateVersion: null,
      active: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    expect(ok.id).toBe("b_1");
    expect(ok.tags).toEqual(["qwen", "throughput"]);
    expect(ok.active).toBe(true);
  });

  it("requires userId, runId, name, active, timestamps", () => {
    expect(() =>
      baselineSchema.parse({
        id: "b_1",
        // userId missing
        runId: "r_1",
        name: "x",
        tags: [],
        templateId: null,
        templateVersion: null,
        active: true,
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      } as unknown),
    ).toThrow();
  });
});

describe("baselineSummarySchema", () => {
  it("is the {id, name, createdAt} subset", () => {
    const summary = baselineSummarySchema.parse({
      id: "b_1",
      name: "throughput-anchor",
      createdAt: "2026-05-02T00:00:00.000Z",
    });
    expect(summary.id).toBe("b_1");
    expect(summary.name).toBe("throughput-anchor");
  });
});

describe("createBaselineSchema", () => {
  it("accepts the minimal payload (runId + name only)", () => {
    const out = createBaselineSchema.parse({ runId: "r_1", name: "smoke" });
    expect(out.runId).toBe("r_1");
    expect(out.name).toBe("smoke");
    expect(out.tags).toEqual([]);
    expect(out.description).toBeUndefined();
  });

  it("accepts description + tags", () => {
    const out = createBaselineSchema.parse({
      runId: "r_1",
      name: "smoke",
      description: "the good run",
      tags: ["a", "b"],
    });
    expect(out.description).toBe("the good run");
    expect(out.tags).toEqual(["a", "b"]);
  });

  it("rejects empty name", () => {
    expect(() => createBaselineSchema.parse({ runId: "r_1", name: "" })).toThrow();
  });

  it("rejects name longer than 200 chars", () => {
    expect(() =>
      createBaselineSchema.parse({ runId: "r_1", name: "x".repeat(201) }),
    ).toThrow();
  });
});

describe("listBaselinesResponseSchema", () => {
  it("wraps an items array", () => {
    const out = listBaselinesResponseSchema.parse({ items: [] });
    expect(out.items).toEqual([]);
  });
});
```

Add a second describe block in the same file covering the Run additions. Append at the bottom of `packages/contracts/src/baseline.spec.ts`:

```ts
import { listRunsQuerySchema, runSchema } from "./run.js";

describe("runSchema (post-#43 additions)", () => {
  it("accepts baselineFor as null", () => {
    const r = runSchema.parse({ ...minimalRun(), baselineFor: null });
    expect(r.baselineFor).toBeNull();
  });

  it("accepts baselineFor as a BaselineSummary", () => {
    const r = runSchema.parse({
      ...minimalRun(),
      baselineFor: { id: "b_1", name: "anchor", createdAt: "2026-05-02T00:00:00.000Z" },
    });
    expect(r.baselineFor?.id).toBe("b_1");
  });

  it("rejects baselineFor with extra fields shaped wrong", () => {
    expect(() =>
      runSchema.parse({ ...minimalRun(), baselineFor: { id: 123 } as unknown }),
    ).toThrow();
  });
});

describe("listRunsQuerySchema (post-#43 additions)", () => {
  it("accepts isBaseline boolean", () => {
    const out = listRunsQuerySchema.parse({ isBaseline: true });
    expect(out.isBaseline).toBe(true);
  });

  it("accepts referencesBaseline boolean", () => {
    const out = listRunsQuerySchema.parse({ referencesBaseline: true });
    expect(out.referencesBaseline).toBe(true);
  });

  it("coerces string 'true' / 'false' (URL-encoded) to boolean", () => {
    const out = listRunsQuerySchema.parse({ isBaseline: "true" });
    expect(out.isBaseline).toBe(true);
    const out2 = listRunsQuerySchema.parse({ referencesBaseline: "false" });
    expect(out2.referencesBaseline).toBe(false);
  });
});

function minimalRun() {
  return {
    id: "r1",
    userId: "u1",
    connectionId: null,
    connection: null,
    kind: "benchmark" as const,
    tool: "guidellm" as const,
    scenario: {},
    mode: "fixed" as const,
    driverKind: "local" as const,
    name: null,
    description: null,
    status: "completed" as const,
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    canonicalReport: null,
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    logs: null,
    createdAt: "2026-05-02T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null as null | { id: string; name: string; createdAt: string },
  };
}
```

### Step 2: Run the tests to verify they fail

```bash
pnpm -F @modeldoctor/contracts exec vitest run src/baseline.spec.ts
```

Expected: every test in the file fails because `./baseline.js` does not exist yet, and `runSchema` does not yet have `baselineFor` / `listRunsQuerySchema` does not yet have the boolean fields.

### Step 3: Create `packages/contracts/src/baseline.ts`

```ts
import { z } from "zod";

/** Summary embedded into RunDto.baselineFor — minimum needed by detail page. */
export const baselineSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime(),
});
export type BaselineSummary = z.infer<typeof baselineSummarySchema>;

/** Full row over the wire. Mirrors prisma `Baseline` columns. */
export const baselineSchema = z.object({
  id: z.string(),
  userId: z.string(),
  runId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  templateId: z.string().nullable(),
  templateVersion: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Baseline = z.infer<typeof baselineSchema>;

/** POST /baselines payload. Server fills userId / templateId / templateVersion / active. */
export const createBaselineSchema = z.object({
  runId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type CreateBaseline = z.infer<typeof createBaselineSchema>;

export const listBaselinesResponseSchema = z.object({
  items: z.array(baselineSchema),
});
export type ListBaselinesResponse = z.infer<typeof listBaselinesResponseSchema>;
```

### Step 4: Extend `packages/contracts/src/run.ts`

Open the file. Add `baselineFor` to `runSchema` (after `completedAt`) and `isBaseline` / `referencesBaseline` to `listRunsQuerySchema` (after `createdBefore`). Use the imports from `./baseline.js`.

Replace the top import block:

```ts
import { z } from "zod";
import { baselineSummarySchema } from "./baseline.js";
```

Inside `runSchema`, add a final field right before the closing `})` (i.e. after `completedAt`):

```ts
  // Populated by GET /runs/:id when this Run is the canonical Run of a
  // baseline (Baseline.runId === this.id). Null otherwise.
  baselineFor: baselineSummarySchema.nullable(),
```

Inside `listRunsQuerySchema`, add right before the closing `})`:

```ts
  isBaseline: z.coerce.boolean().optional(),
  referencesBaseline: z.coerce.boolean().optional(),
```

Note: `z.coerce.boolean()` accepts the string `"true"` / `"false"` that arrive from URL query params and normalises to JS boolean.

### Step 5: Re-export baseline from `packages/contracts/src/index.ts`

Append one line at the bottom:

```ts
export * from "./baseline.js";
```

### Step 6: Re-run the contracts tests

```bash
pnpm -F @modeldoctor/contracts exec vitest run src/baseline.spec.ts
```

Expected: all tests pass.

### Step 7: Type-check + lint contracts

```bash
pnpm -F @modeldoctor/contracts type-check
pnpm -F @modeldoctor/contracts exec biome check src/baseline.ts src/baseline.spec.ts src/run.ts src/index.ts
```

Expected: no errors. (Pre-existing `connection.ts` format error in main is out of scope; do not touch it.)

### Step 8: Build contracts so api/web pick up new types

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: clean build, `packages/contracts/dist/baseline.{js,d.ts}` exist.

### Step 9: Commit

```bash
git add packages/contracts/src/baseline.ts packages/contracts/src/baseline.spec.ts packages/contracts/src/run.ts packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
build(contracts): add baseline DTOs + extend RunDto with baselineFor + RunListQuery filters

Adds `baselineSchema`, `baselineSummarySchema`, `createBaselineSchema`, and
`listBaselinesResponseSchema` plus their inferred types. Extends `runSchema`
with `baselineFor: BaselineSummary | null` (populated by GET /runs/:id when
the Run is the canonical Run of a Baseline), and adds `isBaseline` /
`referencesBaseline` boolean filters to `listRunsQuerySchema`.

Pure type / zod additions. No runtime change. Unblocks the api Baseline
module and the web feature work.

Refs: #43

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Prisma schema — `Baseline.run` `onDelete: Restrict` + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<TS>_baseline_run_immutability/migration.sql` (prisma-generated)

This task is the schema correction that makes "Run.baseline-canonical is immutable" enforceable at the DB level.

### Step 1: Edit the schema

Open `apps/api/prisma/schema.prisma`. In the `Baseline` model, find:

```prisma
  run         Run   @relation("BaselineCanonicalRun", fields: [runId], references: [id], onDelete: Cascade)
```

Replace with:

```prisma
  run         Run   @relation("BaselineCanonicalRun", fields: [runId], references: [id], onDelete: Restrict)
```

No other field changes.

### Step 2: Generate the migration

```bash
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name baseline_run_immutability
```

Expected output: `prisma/migrations/<timestamp>_baseline_run_immutability/migration.sql` is created. Inspect the file — it should contain a single `ALTER TABLE "baselines" DROP CONSTRAINT "baselines_run_id_fkey" ... ADD CONSTRAINT "baselines_run_id_fkey" ... ON DELETE RESTRICT` block.

If prisma asks "Are you sure" or similar, it's because the shadow DB diff thinks the migration would drop data. It should not — read the SQL file. If it's not just an FK swap, stop and report the deviation.

### Step 3: Apply the migration

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
```

Expected: applies the new migration, regenerates the Prisma Client. No `[+] Added` / `[-] Removed` columns; only the constraint flip.

### Step 4: Verify the constraint at the DB level

```bash
psql 'postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor' -c "\d baselines" | grep run_id
```

Expected: line includes `ON DELETE RESTRICT` (psql renders the constraint definition).

### Step 5: Type-check api

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: 0 errors. (Prisma client regeneration in step 3 may take a few seconds; if `Prisma.BaselineDefaultArgs` etc. are missing, run `pnpm -F @modeldoctor/api exec prisma generate` and retry.)

### Step 6: Commit

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
build(api/prisma): flip Baseline.run FK to onDelete: Restrict

Issue #43 says "baseline 关联的 Run 不可变：禁止删除". The current FK has
`onDelete: Cascade`, which is the opposite — deleting the canonical Run
quietly takes the Baseline with it. Switch to `onDelete: Restrict` so
Postgres rejects the DELETE at the DB layer (Prisma surfaces P2003).

Migration is prisma-generated — a single ALTER CONSTRAINT pair. Pre-prod,
no live data; the constraint flip is invisible until something tries to
delete a baseline-anchored Run.

The inverse relation (Run.baseline → baselines.id) keeps `onDelete: SetNull`:
deleting a Baseline simply un-links the Runs that compared against it.

Refs: #43

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: API — new `apps/api/src/modules/baseline/` module

**Files:**
- Create: `apps/api/src/modules/baseline/baseline.module.ts`
- Create: `apps/api/src/modules/baseline/baseline.service.ts`
- Create: `apps/api/src/modules/baseline/baseline.service.spec.ts`
- Create: `apps/api/src/modules/baseline/baseline.controller.ts`
- Create: `apps/api/src/modules/baseline/baseline.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

Mirrors the `connection` module exactly — same auth, same patterns, same testing strategy.

### Step 1: Write the failing service spec

Create `apps/api/src/modules/baseline/baseline.service.spec.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, type Baseline as PrismaBaseline, type Run as PrismaRun } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineService } from "./baseline.service.js";

function makePrismaMock() {
  return {
    baseline: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    run: {
      findUnique: vi.fn(),
    },
  };
}

function makeRun(overrides: Partial<PrismaRun> = {}): PrismaRun {
  return {
    id: "r_1",
    userId: "u_1",
    connectionId: null,
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: null,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    canonicalReport: null,
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    logs: null,
    createdAt: new Date("2026-05-02T00:00:00Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<PrismaBaseline> = {}): PrismaBaseline {
  return {
    id: "b_1",
    userId: "u_1",
    runId: "r_1",
    name: "throughput-anchor",
    description: null,
    tags: [],
    templateId: null,
    templateVersion: null,
    active: true,
    createdAt: new Date("2026-05-02T00:00:00Z"),
    updatedAt: new Date("2026-05-02T00:00:00Z"),
    ...overrides,
  };
}

async function makeService(prismaMock: ReturnType<typeof makePrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      BaselineService,
      { provide: PrismaService, useValue: prismaMock },
    ],
  }).compile();
  return moduleRef.get(BaselineService);
}

describe("BaselineService", () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let service: BaselineService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    service = await makeService(prismaMock);
  });

  describe("create", () => {
    it("creates with userId from caller, copies templateId/version from Run", async () => {
      prismaMock.run.findUnique.mockResolvedValue(
        makeRun({ templateId: null, templateVersion: null }),
      );
      let created: Record<string, unknown> = {};
      prismaMock.baseline.create.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          created = args.data;
          return makeBaseline();
        },
      );
      const out = await service.create("u_1", {
        runId: "r_1",
        name: "throughput-anchor",
        tags: [],
      });
      expect(created.userId).toBe("u_1");
      expect(created.runId).toBe("r_1");
      expect(created.templateId).toBeNull();
      expect(created.templateVersion).toBeNull();
      expect(out.id).toBe("b_1");
    });

    it("404 when Run does not exist", async () => {
      prismaMock.run.findUnique.mockResolvedValue(null);
      await expect(
        service.create("u_1", { runId: "r_x", name: "x", tags: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it("403 when Run belongs to a different user", async () => {
      prismaMock.run.findUnique.mockResolvedValue(makeRun({ userId: "u_other" }));
      await expect(
        service.create("u_1", { runId: "r_1", name: "x", tags: [] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("409 when the Run already has a baseline (P2002 on runId)", async () => {
      prismaMock.run.findUnique.mockResolvedValue(makeRun());
      const dup = new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "x",
      });
      prismaMock.baseline.create.mockRejectedValue(dup);
      await expect(
        service.create("u_1", { runId: "r_1", name: "x", tags: [] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("list", () => {
    it("returns items scoped to userId, createdAt desc", async () => {
      prismaMock.baseline.findMany.mockResolvedValue([
        makeBaseline({ id: "b_2", createdAt: new Date("2026-05-02T01:00:00Z") }),
        makeBaseline({ id: "b_1", createdAt: new Date("2026-05-02T00:00:00Z") }),
      ]);
      const out = await service.list("u_1");
      expect(prismaMock.baseline.findMany).toHaveBeenCalledWith({
        where: { userId: "u_1" },
        orderBy: { createdAt: "desc" },
      });
      expect(out.items.map((b) => b.id)).toEqual(["b_2", "b_1"]);
    });
  });

  describe("delete", () => {
    it("404 when missing", async () => {
      prismaMock.baseline.findUnique.mockResolvedValue(null);
      await expect(service.delete("u_1", "b_x")).rejects.toThrow(NotFoundException);
      expect(prismaMock.baseline.delete).not.toHaveBeenCalled();
    });

    it("403 when not owned", async () => {
      prismaMock.baseline.findUnique.mockResolvedValue(makeBaseline({ userId: "u_other" }));
      await expect(service.delete("u_1", "b_1")).rejects.toThrow(ForbiddenException);
      expect(prismaMock.baseline.delete).not.toHaveBeenCalled();
    });

    it("calls prisma.baseline.delete after ownership check", async () => {
      prismaMock.baseline.findUnique.mockResolvedValue(makeBaseline());
      prismaMock.baseline.delete.mockResolvedValue(makeBaseline());
      await service.delete("u_1", "b_1");
      expect(prismaMock.baseline.delete).toHaveBeenCalledWith({ where: { id: "b_1" } });
    });
  });
});
```

### Step 2: Run the tests to verify they fail

```bash
pnpm -F @modeldoctor/api exec vitest run src/modules/baseline/baseline.service.spec.ts
```

Expected: file fails to load — `./baseline.service.js` does not exist.

### Step 3: Create `apps/api/src/modules/baseline/baseline.service.ts`

```ts
import type {
  Baseline,
  CreateBaseline,
  ListBaselinesResponse,
} from "@modeldoctor/contracts";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Baseline as PrismaBaseline } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class BaselineService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateBaseline): Promise<Baseline> {
    const run = await this.prisma.run.findUnique({ where: { id: input.runId } });
    if (!run) throw new NotFoundException(`Run ${input.runId} not found`);
    if (run.userId !== userId) throw new ForbiddenException();

    try {
      const row = await this.prisma.baseline.create({
        data: {
          userId,
          runId: input.runId,
          name: input.name,
          description: input.description ?? null,
          tags: input.tags ?? [],
          // Copied from Run; both are NULL pre-#56.
          templateId: run.templateId,
          templateVersion: run.templateVersion,
        },
      });
      return toContract(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`Run ${input.runId} already has a baseline`);
      }
      throw err;
    }
  }

  async list(userId: string): Promise<ListBaselinesResponse> {
    const rows = await this.prisma.baseline.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map(toContract) };
  }

  async delete(userId: string, id: string): Promise<void> {
    const row = await this.prisma.baseline.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Baseline ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    await this.prisma.baseline.delete({ where: { id } });
  }
}

function toContract(row: PrismaBaseline): Baseline {
  return {
    id: row.id,
    userId: row.userId,
    runId: row.runId,
    name: row.name,
    description: row.description,
    tags: row.tags,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { toContract as baselineRowToContract };
```

### Step 4: Re-run the service spec — it should pass

```bash
pnpm -F @modeldoctor/api exec vitest run src/modules/baseline/baseline.service.spec.ts
```

Expected: all tests pass.

### Step 5: Write the controller spec

Create `apps/api/src/modules/baseline/baseline.controller.spec.ts`:

```ts
import type { Baseline, ListBaselinesResponse } from "@modeldoctor/contracts";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BaselineController } from "./baseline.controller.js";
import { BaselineService } from "./baseline.service.js";

const USER: JwtPayload = { sub: "u_1", email: "alice@example.com", roles: [] };

const FIXTURE: Baseline = {
  id: "b_1",
  userId: "u_1",
  runId: "r_1",
  name: "throughput-anchor",
  description: null,
  tags: [],
  templateId: null,
  templateVersion: null,
  active: true,
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
};
const LIST: ListBaselinesResponse = { items: [FIXTURE] };

function makeMockService() {
  return { create: vi.fn(), list: vi.fn(), delete: vi.fn() };
}

describe("BaselineController", () => {
  let controller: BaselineController;
  let svc: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    svc = makeMockService();
    const moduleRef = await Test.createTestingModule({
      controllers: [BaselineController],
      providers: [{ provide: BaselineService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BaselineController);
  });

  describe("list", () => {
    it("calls service.list(userId)", async () => {
      svc.list.mockResolvedValue(LIST);
      const out = await controller.list(USER);
      expect(svc.list).toHaveBeenCalledWith("u_1");
      expect(out).toBe(LIST);
    });
  });

  describe("create", () => {
    it("calls service.create(userId, body)", async () => {
      svc.create.mockResolvedValue(FIXTURE);
      const body = { runId: "r_1", name: "throughput-anchor", tags: [] };
      const out = await controller.create(USER, body);
      expect(svc.create).toHaveBeenCalledWith("u_1", body);
      expect(out).toBe(FIXTURE);
    });

    it("propagates 404 / 403 / 409 from service", async () => {
      svc.create.mockRejectedValueOnce(new NotFoundException("r_x"));
      await expect(
        controller.create(USER, { runId: "r_x", name: "x", tags: [] }),
      ).rejects.toThrow(NotFoundException);

      svc.create.mockRejectedValueOnce(new ForbiddenException());
      await expect(
        controller.create(USER, { runId: "r_other", name: "x", tags: [] }),
      ).rejects.toThrow(ForbiddenException);

      svc.create.mockRejectedValueOnce(new ConflictException("dup"));
      await expect(
        controller.create(USER, { runId: "r_1", name: "x", tags: [] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("remove", () => {
    it("calls service.delete(userId, id) and returns void", async () => {
      svc.delete.mockResolvedValue(undefined);
      const out = await controller.remove(USER, "b_1");
      expect(svc.delete).toHaveBeenCalledWith("u_1", "b_1");
      expect(out).toBeUndefined();
    });
  });
});
```

### Step 6: Run controller spec — verify it fails

```bash
pnpm -F @modeldoctor/api exec vitest run src/modules/baseline/baseline.controller.spec.ts
```

Expected: file fails — `./baseline.controller.js` does not exist.

### Step 7: Create `apps/api/src/modules/baseline/baseline.controller.ts`

```ts
import {
  type Baseline,
  type CreateBaseline,
  type ListBaselinesResponse,
  createBaselineSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BaselineService } from "./baseline.service.js";

@Controller("baselines")
@UseGuards(JwtAuthGuard)
export class BaselineController {
  constructor(private readonly service: BaselineService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListBaselinesResponse> {
    return this.service.list(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createBaselineSchema)) body: CreateBaseline,
  ): Promise<Baseline> {
    return this.service.create(user.sub, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
```

### Step 8: Create the module

`apps/api/src/modules/baseline/baseline.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineController } from "./baseline.controller.js";
import { BaselineService } from "./baseline.service.js";

@Module({
  controllers: [BaselineController],
  providers: [PrismaService, BaselineService],
  exports: [BaselineService],
})
export class BaselineModule {}
```

### Step 9: Register in `apps/api/src/app.module.ts`

Add the import next to the other modules (alphabetical order in this file is by feature; place after `AuthModule`):

```ts
import { BaselineModule } from "./modules/baseline/baseline.module.js";
```

Inside `imports: [...]`, add `BaselineModule` (right after `AuthModule` — keep the same grouping logic the existing file uses).

### Step 10: Run all api tests

```bash
pnpm -F @modeldoctor/api exec vitest run --no-file-parallelism
```

Expected: all pass (313 + new specs).

`--no-file-parallelism` is required: pre-existing parallel-test pollution against the shared dev DB causes flakes in unrelated specs that share `prisma.user.deleteMany()` style cleanup. Out-of-scope for this PR.

### Step 11: Type-check + lint

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api exec biome check src/modules/baseline src/app.module.ts
```

Expected: 0 errors.

### Step 12: Commit

```bash
git add apps/api/src/modules/baseline/ apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api/baseline): POST/GET/DELETE /baselines + service guards

Adds a new NestJS module modeled on `connection`. Three JWT-guarded routes:

- POST /baselines  — validate runId belongs to current user, copy
  templateId/templateVersion from the source Run (both NULL pre-#56),
  P2002 → 409 ("this Run already has a baseline").
- GET /baselines   — current user's baselines, createdAt desc.
- DELETE /baselines/:id — ownership check then delete; the canonical Run
  is untouched (FK Restrict landed in the previous commit), referencing
  Runs' baselineId is set to NULL automatically (FK SetNull, unchanged).

Tests cover happy + 404 + 403 + 409 paths plus controller wiring.

Refs: #43

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Run module — `baselineFor` on DTO + `isBaseline` / `referencesBaseline` filters

**Files:**
- Modify: `apps/api/src/modules/run/run.repository.ts`
- Modify: `apps/api/src/modules/run/run.repository.spec.ts`
- Modify: `apps/api/src/modules/run/run.service.ts`

### Step 1: Add the failing repository tests

Open `apps/api/src/modules/run/run.repository.spec.ts`. Append three new `it` blocks at the bottom of the existing `describe("RunRepository", ...)` block, before the closing brace.

```ts
  it("filters by isBaseline=true (returns only Runs that ARE a baseline)", async () => {
    const user = await prisma.user.create({
      data: { email: "is-baseline@example.com", passwordHash: "x" },
    });
    const r1 = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    await prisma.baseline.create({
      data: { userId: user.id, runId: r1.id, name: "anchor" },
    });

    const onlyBaselines = await repo.list({ isBaseline: true });
    expect(onlyBaselines.items).toHaveLength(1);
    expect(onlyBaselines.items[0].id).toBe(r1.id);
  });

  it("filters by referencesBaseline=true (returns only Runs whose baselineId is set)", async () => {
    const user = await prisma.user.create({
      data: { email: "ref-baseline@example.com", passwordHash: "x" },
    });
    const canonical = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    const baseline = await prisma.baseline.create({
      data: { userId: user.id, runId: canonical.id, name: "anchor" },
    });
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
      baselineId: baseline.id,
    });
    await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });

    const refs = await repo.list({ referencesBaseline: true });
    expect(refs.items).toHaveLength(1);
    expect(refs.items[0].baselineId).toBe(baseline.id);
  });

  it("findById includes baselineFor when the Run is a baseline canonical Run", async () => {
    const user = await prisma.user.create({
      data: { email: "find-baseline@example.com", passwordHash: "x" },
    });
    const r = await repo.create({
      userId: user.id,
      kind: "benchmark",
      tool: "guidellm",
      scenario: {},
      mode: "fixed",
      driverKind: "local",
      params: {},
    });
    await prisma.baseline.create({
      data: { userId: user.id, runId: r.id, name: "anchor" },
    });

    const fetched = await repo.findById(r.id);
    expect(fetched?.baselineFor?.name).toBe("anchor");
  });
```

Also extend the `beforeEach` cleanup chain (around line 30) to wipe `baseline` rows before `run`:

```ts
    await prisma.baseline.deleteMany();
    await prisma.run.deleteMany();
    await prisma.user.deleteMany();
```

### Step 2: Run the repository spec — verify the new tests fail

```bash
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
pnpm -F @modeldoctor/api exec vitest run src/modules/run/run.repository.spec.ts --no-file-parallelism
```

Expected: the three new tests fail (`isBaseline` / `referencesBaseline` not yet wired; `baselineFor` not in include).

### Step 3: Extend `apps/api/src/modules/run/run.repository.ts`

Replace the `runWithConnection` validator block (lines ~5-8) with a richer validator that also includes `baselineFor`:

```ts
const runWithRelations = Prisma.validator<Prisma.RunDefaultArgs>()({
  include: {
    connection: { select: { id: true, name: true } },
    baselineFor: { select: { id: true, name: true, createdAt: true } },
  },
});
export type RunWithConnection = Prisma.RunGetPayload<typeof runWithRelations>;
```

Update both internal references to use `runWithRelations.include` instead of `runWithConnection.include`. (There are two: `findById` at line 81 and `list` at line 113.)

> Renaming the local const from `runWithConnection` to `runWithRelations` is intentional — the Prisma payload now spans more than one relation, and the old name would mislead.

In the `ListRunsInput` type (around line 40), add the two boolean filters:

```ts
export type ListRunsInput = {
  kind?: "benchmark" | "e2e";
  tool?: string;
  status?: string;
  connectionId?: string;
  parentRunId?: string;
  userId?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  isBaseline?: boolean;
  referencesBaseline?: boolean;
  cursor?: string;
  limit?: number;
};
```

In `RunRepository.list`, after the `if (input.search) ... ` block and before the `createdAt` range block, add:

```ts
    if (input.isBaseline !== undefined) {
      where.baselineFor = input.isBaseline ? { isNot: null } : { is: null };
    }
    if (input.referencesBaseline !== undefined) {
      where.baselineId = input.referencesBaseline ? { not: null } : null;
    }
```

### Step 4: Re-run the repository spec — should pass

```bash
pnpm -F @modeldoctor/api exec vitest run src/modules/run/run.repository.spec.ts --no-file-parallelism
```

Expected: all repository tests pass.

### Step 5: Update `RunService` to pass the new filters and DTO field through

Open `apps/api/src/modules/run/run.service.ts`. The `list` method already spreads `query` into the repo call, so the new boolean filters propagate automatically — but only after we extend the wire-level DTO. Locate the `toContract` function.

Add `baselineFor` to the returned object (place after `completedAt`):

```ts
    baselineFor: row.baselineFor
      ? {
          id: row.baselineFor.id,
          name: row.baselineFor.name,
          createdAt: row.baselineFor.createdAt.toISOString(),
        }
      : null,
```

### Step 6: Type-check api

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: 0 errors. The Run service spec may need a tiny extension if it asserts `toContract` shape — read errors and fix accordingly.

### Step 7: Run the full api test suite to make sure nothing regressed

```bash
pnpm -F @modeldoctor/api exec vitest run --no-file-parallelism
```

Expected: all pass.

### Step 8: Commit

```bash
git add apps/api/src/modules/run/run.repository.ts apps/api/src/modules/run/run.repository.spec.ts apps/api/src/modules/run/run.service.ts
git commit -m "$(cat <<'EOF'
feat(api/run): expose baselineFor on RunDto + isBaseline / referencesBaseline filters

Extends the prisma `runWithConnection` validator to include `baselineFor`
(the inverse of `Baseline.run`) and renames it to `runWithRelations` since
the payload spans more than the one relation now. Run.findById and
Run.list use it; RunService.toContract serialises the relation as a
BaselineSummary (id / name / createdAt) when present.

Adds two filters to RunRepository.list:

- isBaseline: where.baselineFor = { isNot|is: null }
- referencesBaseline: where.baselineId = { not|is: null }

These cover the /history "Is a baseline" / "References a baseline"
dropdown states. The picker-backed "References baseline X" mode is
deferred to #45 per the spec; tracked on that issue.

Refs: #43

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Web — `apps/web/src/features/baseline/` API client + react-query hooks

**Files:**
- Create: `apps/web/src/features/baseline/api.ts`
- Create: `apps/web/src/features/baseline/queries.ts`
- Create: `apps/web/src/features/baseline/queries.test.tsx`

This task ships only the data plumbing — no UI. Task 6 consumes these hooks.

### Step 1: Write the failing query test

Create `apps/web/src/features/baseline/queries.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api, ApiError } from "@/lib/api-client";
import { useCreateBaseline, useDeleteBaseline, useBaselines } from "./queries";

function makeWrapper() {
  return ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("baseline queries", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("useBaselines fetches GET /api/baselines and returns items", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [] });
    const { result } = renderHook(() => useBaselines(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/baselines");
    expect(result.current.data?.items).toEqual([]);
  });

  it("useCreateBaseline POSTs and returns the created BaselineDto", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      id: "b_1",
      userId: "u_1",
      runId: "r_1",
      name: "anchor",
      description: null,
      tags: [],
      templateId: null,
      templateVersion: null,
      active: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const { result } = renderHook(() => useCreateBaseline(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ runId: "r_1", name: "anchor", tags: [] });
    });
    expect(api.post).toHaveBeenCalledWith("/api/baselines", {
      runId: "r_1",
      name: "anchor",
      tags: [],
    });
    expect(result.current.data?.id).toBe("b_1");
  });

  it("useCreateBaseline surfaces 409 as ApiError", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, "Run r_1 already has a baseline"));
    const { result } = renderHook(() => useCreateBaseline(), { wrapper: makeWrapper() });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ runId: "r_1", name: "x", tags: [] }),
      ).rejects.toBeInstanceOf(ApiError);
    });
    expect((result.current.error as ApiError).status).toBe(409);
  });

  it("useDeleteBaseline DELETEs the baseline by id", async () => {
    vi.mocked(api.del).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteBaseline(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync("b_1");
    });
    expect(api.del).toHaveBeenCalledWith("/api/baselines/b_1");
  });
});
```

### Step 2: Run the test — should fail (no implementation)

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/baseline/queries.test.tsx
```

Expected: file fails — `./api` and `./queries` not found.

### Step 3: Create `apps/web/src/features/baseline/api.ts`

```ts
import { api } from "@/lib/api-client";
import type {
  Baseline,
  CreateBaseline,
  ListBaselinesResponse,
} from "@modeldoctor/contracts";

export const baselineApi = {
  list: () => api.get<ListBaselinesResponse>("/api/baselines"),
  create: (body: CreateBaseline) => api.post<Baseline>("/api/baselines", body),
  remove: (id: string) => api.del<void>(`/api/baselines/${id}`),
};
```

### Step 4: Create `apps/web/src/features/baseline/queries.ts`

```ts
import type { Baseline, CreateBaseline, ListBaselinesResponse } from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { baselineApi } from "./api";

export const baselineKeys = {
  all: ["baselines"] as const,
  lists: () => [...baselineKeys.all, "list"] as const,
};

export function useBaselines() {
  return useQuery<ListBaselinesResponse>({
    queryKey: baselineKeys.lists(),
    queryFn: () => baselineApi.list(),
    staleTime: 30_000,
  });
}

export function useCreateBaseline() {
  const qc = useQueryClient();
  return useMutation<Baseline, Error, CreateBaseline>({
    mutationFn: (body) => baselineApi.create(body),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: baselineKeys.all });
      // The Run that just became a baseline now has baselineFor set; refetch.
      qc.invalidateQueries({ queryKey: ["history", "detail", created.runId] });
      qc.invalidateQueries({ queryKey: ["history", "list"] });
    },
  });
}

export function useDeleteBaseline() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => baselineApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: baselineKeys.all });
      qc.invalidateQueries({ queryKey: ["history", "detail"] });
      qc.invalidateQueries({ queryKey: ["history", "list"] });
    },
  });
}
```

### Step 5: Re-run the test — should pass

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/baseline/queries.test.tsx
```

Expected: all 4 tests pass.

### Step 6: Type-check + lint web

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/baseline
```

Expected: 0 errors.

### Step 7: Commit

```bash
git add apps/web/src/features/baseline/
git commit -m "$(cat <<'EOF'
feat(web/baseline): API client + react-query hooks

Adds `apps/web/src/features/baseline/` with:

- `api.ts` — fetch wrappers (`baselineApi.list / create / remove`).
- `queries.ts` — `useBaselines`, `useCreateBaseline`, `useDeleteBaseline`
  with cache invalidation on the affected Run detail + run list +
  baselines list.
- `queries.test.tsx` — covers happy paths and 409 surfacing as ApiError.

Lives outside `features/history/` because it's the natural home for the
future baselines list page; `history` consumes the hooks via import.

Refs: #43

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Web `HistoryDetailPage` — Set/Unset baseline button + dialog

**Files:**
- Modify: `apps/web/src/features/history/HistoryDetailPage.tsx`
- Create: `apps/web/src/features/history/SetBaselineDialog.tsx`
- Create: `apps/web/src/features/history/__tests__/SetBaselineDialog.test.tsx`
- Modify: `apps/web/src/features/history/__tests__/HistoryDetailPage.test.tsx`
- Modify: `apps/web/src/locales/en-US/history.json`
- Modify: `apps/web/src/locales/zh-CN/history.json`

### Step 1: Add new i18n keys

Open `apps/web/src/locales/en-US/history.json`. Inside `"detail": { ... }` add a new `"baseline"` block as a sibling of `"metadata"`, `"metrics"`, `"rawOutput"`:

```json
    "baseline": {
      "setButton": "Set as baseline",
      "unsetButton": "✓ Baseline · Unset",
      "unsetConfirmTitle": "Unset this baseline?",
      "unsetConfirmBody": "This removes the baseline mark; the Run itself stays. Other Runs that compared against this baseline keep their data; their `baselineId` link is cleared.",
      "unsetConfirmAction": "Unset baseline",
      "dialog": {
        "title": "Set as baseline",
        "body": "Mark this Run as a reference for future regression diffs.",
        "nameLabel": "Name",
        "namePlaceholder": "e.g. throughput-baseline-v1",
        "descriptionLabel": "Description (optional)",
        "tagsLabel": "Tags (comma separated, optional)",
        "submit": "Save",
        "cancel": "Cancel"
      },
      "errors": {
        "alreadyExists": "This Run already has a baseline.",
        "generic": "Could not save baseline."
      }
    }
```

Open `apps/web/src/locales/zh-CN/history.json`. Inside `"detail": { ... }` add the matching block:

```json
    "baseline": {
      "setButton": "设为基线",
      "unsetButton": "✓ 已是基线 · 取消",
      "unsetConfirmTitle": "取消基线？",
      "unsetConfirmBody": "只移除基线标记，Run 本身保留。曾经与这个基线对比过的其它 Run 数据保留，其 baselineId 关联会被清空。",
      "unsetConfirmAction": "取消基线",
      "dialog": {
        "title": "设为基线",
        "body": "把这个 Run 标为参照，后续 regression diff 用它作为锚点。",
        "nameLabel": "名称",
        "namePlaceholder": "比如 throughput-baseline-v1",
        "descriptionLabel": "备注（可选）",
        "tagsLabel": "标签（逗号分隔，可选）",
        "submit": "保存",
        "cancel": "取消"
      },
      "errors": {
        "alreadyExists": "这个 Run 已经是基线了。",
        "generic": "保存基线失败。"
      }
    }
```

### Step 2: Write the failing dialog test

Create `apps/web/src/features/history/__tests__/SetBaselineDialog.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { SetBaselineDialog } from "../SetBaselineDialog";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("SetBaselineDialog", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it("submits {runId, name, description, tags} and calls onSuccess", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      id: "b_1",
      userId: "u_1",
      runId: "r_1",
      name: "anchor",
      description: "desc",
      tags: ["a", "b"],
      templateId: null,
      templateVersion: null,
      active: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const onSuccess = vi.fn();
    render(
      <SetBaselineDialog runId="r_1" open={true} onOpenChange={() => {}} onSuccess={onSuccess} />,
      { wrapper: Wrapper },
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Name|名称/), "anchor");
    await user.type(screen.getByLabelText(/Description|备注/), "desc");
    await user.type(screen.getByLabelText(/Tags|标签/), "a, b");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Save|保存/ }));
    });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith("/api/baselines", {
      runId: "r_1",
      name: "anchor",
      description: "desc",
      tags: ["a", "b"],
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("does not submit when name is empty", async () => {
    render(
      <SetBaselineDialog runId="r_1" open={true} onOpenChange={() => {}} onSuccess={() => {}} />,
      { wrapper: Wrapper },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Save|保存/ }));
    expect(api.post).not.toHaveBeenCalled();
  });
});
```

### Step 3: Run dialog test — should fail

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/history/__tests__/SetBaselineDialog.test.tsx
```

Expected: failure — `../SetBaselineDialog` not found.

### Step 4: Create `apps/web/src/features/history/SetBaselineDialog.tsx`

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { useCreateBaseline } from "@/features/baseline/queries";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export interface SetBaselineDialogProps {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SetBaselineDialog({ runId, open, onOpenChange, onSuccess }: SetBaselineDialogProps) {
  const { t } = useTranslation("history");
  const create = useCreateBaseline();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const tags = tagsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    create.mutate(
      {
        runId,
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        tags,
      },
      {
        onSuccess: () => {
          onSuccess?.();
          onOpenChange(false);
          // Reset for next open.
          setName("");
          setDescription("");
          setTagsInput("");
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            toast.error(t("detail.baseline.errors.alreadyExists"));
          } else {
            toast.error(t("detail.baseline.errors.generic"));
          }
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("detail.baseline.dialog.title")}</DialogTitle>
            <DialogDescription>{t("detail.baseline.dialog.body")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="baseline-name">{t("detail.baseline.dialog.nameLabel")}</Label>
            <Input
              id="baseline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("detail.baseline.dialog.namePlaceholder")}
              maxLength={200}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseline-description">
              {t("detail.baseline.dialog.descriptionLabel")}
            </Label>
            <Textarea
              id="baseline-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseline-tags">{t("detail.baseline.dialog.tagsLabel")}</Label>
            <Input
              id="baseline-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="qwen, throughput"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("detail.baseline.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
              {t("detail.baseline.dialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

> Verify the imports resolve: `@/components/ui/dialog`, `label`, `textarea` — these are shadcn/ui components that must already exist in this repo (the project uses them elsewhere). If `Textarea` is missing, run `pnpm -F @modeldoctor/web exec npx shadcn@latest add textarea`. Report the deviation if you have to add it.

### Step 5: Re-run dialog test — should pass

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/history/__tests__/SetBaselineDialog.test.tsx
```

Expected: both tests pass.

### Step 6: Extend `HistoryDetailPage.test.tsx`

Open `apps/web/src/features/history/__tests__/HistoryDetailPage.test.tsx`. Append two new `it` blocks inside the existing `describe("HistoryDetailPage", ...)`:

```tsx
  it("renders 'Set as baseline' when run.baselineFor is null", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ baselineFor: null }));
    render(<HistoryDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Set as baseline|设为基线/ })).toBeInTheDocument(),
    );
  });

  it("renders 'Unset' when run.baselineFor is populated", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        baselineFor: { id: "b_1", name: "anchor", createdAt: "2026-05-02T00:00:00.000Z" },
      }),
    );
    render(<HistoryDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Baseline · Unset|已是基线/ })).toBeInTheDocument(),
    );
  });
```

Also extend `makeRun()` (the fixture factory at the top of the file) to include the new field:

```ts
    baselineFor: null,
```

(Place after `completedAt`.)

### Step 7: Run the existing detail page test — should fail because the buttons aren't rendered yet

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/history/__tests__/HistoryDetailPage.test.tsx
```

Expected: the new `it` blocks fail. The existing 3 tests still pass because the fixture's `baselineFor: null` matches the prior state where the field was absent.

### Step 8: Modify `HistoryDetailPage.tsx` to render the toggle + dialog

Open `apps/web/src/features/history/HistoryDetailPage.tsx`. The full new file content:

```tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useDeleteBaseline } from "@/features/baseline/queries";
import { historyKeys } from "./queries";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, SearchX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { HistoryDetailMetadata } from "./HistoryDetailMetadata";
import { HistoryDetailMetrics } from "./HistoryDetailMetrics";
import { HistoryDetailRawOutput } from "./HistoryDetailRawOutput";
import { SetBaselineDialog } from "./SetBaselineDialog";
import { useRunDetail } from "./queries";

export function HistoryDetailPage() {
  const { t } = useTranslation("history");
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading, isError, error } = useRunDetail(runId ?? "");
  const qc = useQueryClient();

  const [setOpen, setSetOpen] = useState(false);
  const [unsetOpen, setUnsetOpen] = useState(false);
  const remove = useDeleteBaseline();

  if (isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div
          role="status"
          aria-label="loading"
          className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30"
        />
      </>
    );
  }

  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) {
      return (
        <>
          <PageHeader title={runId ?? "—"} />
          <EmptyState
            icon={SearchX}
            title={t("detail.notFound.title")}
            body={t("detail.notFound.body")}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title={runId ?? "—"} />
        <Alert variant="destructive" className="mx-8 mt-6">
          <AlertDescription>
            {(error as Error)?.message ?? t("detail.loadError")}
          </AlertDescription>
        </Alert>
      </>
    );
  }

  if (!run) return null;

  const subtitle = t("detail.subtitle", {
    kind: run.kind,
    tool: run.tool,
    when: format(new Date(run.createdAt), "yyyy-MM-dd HH:mm"),
  });

  const isBaseline = run.baselineFor !== null;

  return (
    <>
      <PageHeader
        title={run.name ?? run.id}
        subtitle={subtitle}
        rightSlot={
          <div className="flex items-center gap-2">
            {isBaseline ? (
              <Button variant="secondary" size="sm" onClick={() => setUnsetOpen(true)}>
                {t("detail.baseline.unsetButton")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSetOpen(true)}>
                {t("detail.baseline.setButton")}
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/history">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("detail.back")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-8 px-8 py-6">
        <section>
          <HistoryDetailMetadata run={run} />
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
          <HistoryDetailMetrics metrics={run.summaryMetrics} />
        </section>
        <section>
          <HistoryDetailRawOutput
            rawOutput={run.rawOutput as Record<string, unknown> | null}
            logs={run.logs}
          />
        </section>
      </div>

      <SetBaselineDialog
        runId={run.id}
        open={setOpen}
        onOpenChange={setSetOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: historyKeys.detail(run.id) })}
      />

      <AlertDialog open={unsetOpen} onOpenChange={setUnsetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.baseline.unsetConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("detail.baseline.unsetConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.baseline.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (run.baselineFor) {
                  remove.mutate(run.baselineFor.id, {
                    onSuccess: () => {
                      setUnsetOpen(false);
                      qc.invalidateQueries({ queryKey: historyKeys.detail(run.id) });
                    },
                  });
                }
              }}
              disabled={remove.isPending}
            >
              {t("detail.baseline.unsetConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

> If `@/components/ui/alert-dialog` doesn't exist, run `pnpm -F @modeldoctor/web exec npx shadcn@latest add alert-dialog` and report the deviation. Same for any other shadcn/ui primitive.

### Step 9: Run the detail page test + dialog test together

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/history/__tests__/HistoryDetailPage.test.tsx src/features/history/__tests__/SetBaselineDialog.test.tsx
```

Expected: all tests pass (3 existing + 2 new in HistoryDetailPage; 2 in SetBaselineDialog).

### Step 10: Run the full web test suite

```bash
pnpm -F @modeldoctor/web test
```

Expected: 449+ pass (447 existing + new ones).

### Step 11: Type-check + lint

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/history src/features/baseline src/locales
```

Expected: 0 errors.

### Step 12: Commit

```bash
git add apps/web/src/features/history/HistoryDetailPage.tsx apps/web/src/features/history/SetBaselineDialog.tsx apps/web/src/features/history/__tests__/SetBaselineDialog.test.tsx apps/web/src/features/history/__tests__/HistoryDetailPage.test.tsx apps/web/src/locales/en-US/history.json apps/web/src/locales/zh-CN/history.json
git commit -m "$(cat <<'EOF'
feat(web/history): Set/Unset baseline button + SetBaselineDialog on detail page

- HistoryDetailPage's PageHeader.rightSlot now renders one of:
  * "Set as baseline" (outline) when run.baselineFor === null
  * "✓ Baseline · Unset" (secondary) when run.baselineFor is populated
- Set opens SetBaselineDialog (name / description / tags). 409 toasts as
  "this Run already has a baseline".
- Unset opens an AlertDialog confirm; on confirm, DELETE /baselines/:id
  via useDeleteBaseline; the canonical Run is untouched (FK Restrict).
- i18n keys added under `detail.baseline.*` for both en-US and zh-CN.

Per the spec, this lives on HistoryDetailPage as a temporary home until
#46 (the report page) lands; that PR will move the toggle to the report
header. Tracked on #46.

Refs: #43

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Web `HistoryFilters` — three-state baseline dropdown

**Files:**
- Modify: `apps/web/src/features/history/HistoryFilters.tsx`
- Modify: `apps/web/src/features/history/HistoryListPage.tsx`
- Modify: `apps/web/src/features/history/queries.ts` (extend RunQuery type usage if needed; should auto-flow from contracts)
- Modify: `apps/web/src/features/history/api.ts` (forward new params on the URL)
- Create: `apps/web/src/features/history/__tests__/HistoryFilters.test.tsx`
- Modify: `apps/web/src/locales/en-US/history.json`
- Modify: `apps/web/src/locales/zh-CN/history.json`

### Step 1: Add i18n keys

Inside `"filters": { ... }` of `apps/web/src/locales/en-US/history.json`, add:

```json
      "baseline": "Baseline",
      "baselineIs": "Is a baseline",
      "baselineRef": "References a baseline",
```

(Place after `"connection": "Connection"` for grouping.)

In `apps/web/src/locales/zh-CN/history.json`, the matching keys:

```json
      "baseline": "基线",
      "baselineIs": "是基线",
      "baselineRef": "对比某个基线",
```

### Step 2: Write the failing filter test

Create `apps/web/src/features/history/__tests__/HistoryFilters.test.tsx`:

```tsx
import type { ListRunsQuery } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { HistoryFilters } from "../HistoryFilters";

describe("HistoryFilters baseline dropdown", () => {
  it("emits isBaseline=true when 'Is a baseline' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListRunsQuery> = {};
    render(<HistoryFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    await user.click(screen.getByRole("option", { name: /Is a baseline|是基线/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isBaseline: true, referencesBaseline: undefined }),
    );
  });

  it("emits referencesBaseline=true when 'References a baseline' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListRunsQuery> = {};
    render(<HistoryFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    await user.click(screen.getByRole("option", { name: /References a baseline|对比某个基线/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ referencesBaseline: true, isBaseline: undefined }),
    );
  });

  it("emits both undefined when 'Any' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListRunsQuery> = { isBaseline: true };
    render(<HistoryFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    // The first option in the baseline select is "Any".
    const anyOptions = screen.getAllByRole("option", { name: /^Any|^全部$/ });
    await user.click(anyOptions[anyOptions.length - 1]);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isBaseline: undefined, referencesBaseline: undefined }),
    );
  });
});
```

### Step 3: Run filter test — should fail

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/history/__tests__/HistoryFilters.test.tsx
```

Expected: failure — the Baseline combobox doesn't exist yet.

### Step 4: Modify `apps/web/src/features/history/HistoryFilters.tsx`

Add a new `Select` after the existing `Status` select. Inside the `return (...)` block, just after the `Status` `<Select>` (closes around line 129), insert:

```tsx
      <Select
        value={
          query.isBaseline ? "is" : query.referencesBaseline ? "ref" : ALL
        }
        onValueChange={(v) => {
          if (v === ALL) patch({ isBaseline: undefined, referencesBaseline: undefined });
          else if (v === "is") patch({ isBaseline: true, referencesBaseline: undefined });
          else if (v === "ref") patch({ isBaseline: undefined, referencesBaseline: true });
        }}
      >
        <SelectTrigger className="w-[180px]" aria-label={t("filters.baseline")}>
          <SelectValue placeholder={t("filters.baseline")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          <SelectItem value="is">{t("filters.baselineIs")}</SelectItem>
          <SelectItem value="ref">{t("filters.baselineRef")}</SelectItem>
        </SelectContent>
      </Select>
```

Also extend the `isFiltered` block (lines 69-76) to include the new fields:

```tsx
  const isFiltered =
    query.kind !== undefined ||
    query.tool !== undefined ||
    query.status !== undefined ||
    query.connectionId !== undefined ||
    query.search !== undefined ||
    query.createdAfter !== undefined ||
    query.createdBefore !== undefined ||
    query.isBaseline !== undefined ||
    query.referencesBaseline !== undefined;
```

### Step 5: Wire URL ↔ state in `HistoryListPage.tsx`

Open `apps/web/src/features/history/HistoryListPage.tsx`. In the `query: Partial<ListRunsQuery> = useMemo(...)` block (around lines 73-91), append:

```tsx
    const isBaseline = get("baseline");
    if (isBaseline === "is") q.isBaseline = true;
    if (isBaseline === "ref") q.referencesBaseline = true;
```

And in `patchQuery` (lines 93-99), the existing loop already serialises every defined value — but it serialises booleans as `"true"` / `"false"` which collides with the existing kind/tool/status string fields. Replace the block with:

```tsx
  function patchQuery(next: Partial<ListRunsQuery>) {
    const sp = new URLSearchParams();
    if (next.kind !== undefined) sp.set("kind", next.kind);
    if (next.tool !== undefined) sp.set("tool", next.tool);
    if (next.status !== undefined) sp.set("status", next.status);
    if (next.connectionId !== undefined) sp.set("connectionId", next.connectionId);
    if (next.search !== undefined) sp.set("search", next.search);
    if (next.createdAfter !== undefined) sp.set("createdAfter", next.createdAfter);
    if (next.createdBefore !== undefined) sp.set("createdBefore", next.createdBefore);
    if (next.isBaseline) sp.set("baseline", "is");
    else if (next.referencesBaseline) sp.set("baseline", "ref");
    setSearchParams(sp);
  }
```

Also extend the `isFiltered` memo:

```tsx
  const isFiltered = useMemo(
    () =>
      query.kind !== undefined ||
      query.tool !== undefined ||
      query.status !== undefined ||
      query.connectionId !== undefined ||
      query.search !== undefined ||
      query.createdAfter !== undefined ||
      query.createdBefore !== undefined ||
      query.isBaseline !== undefined ||
      query.referencesBaseline !== undefined,
    [query],
  );
```

### Step 6: Forward the new fields to the API in `api.ts`

Open `apps/web/src/features/history/api.ts`. In `buildListQuery`, after the existing `if (q.createdBefore)` line, add:

```ts
  if (q.isBaseline !== undefined) usp.set("isBaseline", String(q.isBaseline));
  if (q.referencesBaseline !== undefined) usp.set("referencesBaseline", String(q.referencesBaseline));
```

### Step 7: Run filter tests — should pass

```bash
pnpm -F @modeldoctor/web exec vitest run src/features/history/__tests__/HistoryFilters.test.tsx
```

Expected: 3 tests pass.

### Step 8: Run the full web test suite

```bash
pnpm -F @modeldoctor/web test
```

Expected: all pass.

### Step 9: Type-check + lint

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/history src/locales
```

Expected: 0 errors.

### Step 10: Commit

```bash
git add apps/web/src/features/history/HistoryFilters.tsx apps/web/src/features/history/HistoryListPage.tsx apps/web/src/features/history/api.ts apps/web/src/features/history/__tests__/HistoryFilters.test.tsx apps/web/src/locales/en-US/history.json apps/web/src/locales/zh-CN/history.json
git commit -m "$(cat <<'EOF'
feat(web/history): baseline three-state filter dropdown

Adds a "Baseline" Select to HistoryFilters with three values:

- Any                    → no baseline filter
- Is a baseline          → isBaseline=true on the query
- References a baseline  → referencesBaseline=true on the query

URL state is stored as `baseline=is` / `baseline=ref` (or absent).
HistoryListPage rebuilds the URLSearchParams explicitly per field instead
of via the previous Object.entries loop — booleans don't round-trip
through that loop.

The api.ts query builder forwards `isBaseline` / `referencesBaseline` to
the GET /api/runs query string. The "References baseline X" picker (Q3
option C in the spec) is deferred to #45; tracked on that issue.

Refs: #43

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final smoke + PR

This is the §3.2 / §3.3 of the spec, run after Task 7 lands.

### Step 1: Bring up dev

```bash
pnpm dev
```

Expected: `[web] Local: http://localhost:5173/`, `[api] listening on http://localhost:3001`.

### Step 2: Manual browser smoke

1. Open `http://localhost:5173/login`. Log in as `tz-verify@test.com` / `testpassword123` if the account exists from #69's verify pass; otherwise register a fresh account at `/register`.
2. Trigger a Run via `/load-test` or `/e2e` (whichever has the simplest one-click path).
3. From `/history`, open the Run's detail page. Click "Set as baseline". Fill `Name = "smoke-1"`. Submit.
4. Button flips to "✓ Baseline · Unset". `/history` filter "Is a baseline" includes the row; "References a baseline" excludes it.
5. Trigger a second Run (becomes a regular Run). On its detail the button is "Set as baseline" again.
6. From a shell:
   ```bash
   psql 'postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor' -c \
     "DELETE FROM runs WHERE id='<smoke-1-canonical-run-id>'"
   ```
   Expected: `ERROR: update or delete on table "runs" violates foreign key constraint`.
7. Back on the smoke-1 detail page click "Unset" → confirm. Button flips back to "Set as baseline". Run row remains (verifiable in psql); the Baseline row is gone.
8. Capture screenshots of: detail page with Set button, detail page with Unset button, /history with "Is a baseline" filter applied, the FK-violation psql output.

### Step 3: Push

```bash
git push -u origin feat/benchmark-baseline
```

### Step 4: Open the PR

```bash
gh pr create --title "feat(api/web): #43 benchmark baseline" --body "$(cat <<'EOF'
## Summary

Closes #43.

- New `apps/api/src/modules/baseline/` module: `POST /baselines` / `GET /baselines` / `DELETE /baselines/:id`, JWT-guarded, scoped per user.
- Schema FK fix: `Baseline.run` is now `onDelete: Restrict` so deleting a baseline-anchored Run is rejected by Postgres (P2003), matching the issue's "禁止删除" requirement.
- `RunDto` now includes `baselineFor: BaselineSummary | null`; `RunListQuery` accepts `isBaseline` / `referencesBaseline` boolean filters.
- `apps/web/src/features/baseline/`: API client + react-query hooks. Detail page renders a Set / "✓ Baseline · Unset" toggle in `PageHeader.rightSlot`; `SetBaselineDialog` collects name / description / tags; `AlertDialog` confirms unset. `/history` filter row gains a three-state Baseline dropdown.

## Verification

- `pnpm -r type-check` passes.
- `pnpm -F @modeldoctor/api exec vitest run --no-file-parallelism` — 313+new pass. Pre-existing parallel-test pollution against the shared dev DB is unrelated.
- `pnpm -F @modeldoctor/web test` — 447+new pass.
- Browser smoke (8 steps) executed; screenshots:
  - <attach: detail page with Set>
  - <attach: detail page with Unset>
  - <attach: /history with "Is a baseline" applied>
  - <attach: psql FK-violation>

## Out-of-scope (cleanup obligations tracked on the related issues)

- Templates / `Baseline.templateId` semantics — #56 (commented).
- Move toggle to report page header — #46 (commented).
- POST /runs / Run params PATCH guards — #54 (commented).
- "References baseline X" picker filter — #45 (commented).
EOF
)"
```

---

## Self-Review

Before considering this plan done, run the checklist below.

**1. Spec coverage:**

- §1.2 deliverables → mapped: contracts (Task 1), prisma FK (Task 2), baseline module (Task 3), Run module extensions (Task 4), web baseline dir (Task 5), HistoryDetailPage UI (Task 6), HistoryFilters (Task 7).
- §3 verification → covered: unit specs in each task, full-suite runs gate each commit, browser smoke in Final.
- §4 cleanup obligations → already cross-posted on #56 / #46 / #54 / #45 (referenced in commit messages and PR body).

**2. Placeholder scan:** all code blocks contain real code; no "TBD" / "TODO" / "implement later" anywhere.

**3. Type consistency:** `BaselineSummary` is the single shape used everywhere (`RunDto.baselineFor`, frontend `run.baselineFor.id`). `runWithRelations` rename is propagated within Task 4. `useCreateBaseline` / `useDeleteBaseline` / `useBaselines` names match Tasks 5-6-7. `baselineKeys` matches react-query invalidation keys used in `queries.ts`.

**4. Ambiguity check:** the FK Restrict decision is explicitly documented; the temporary placement of the toggle on HistoryDetailPage (vs the eventual report page) is named in commit body and PR description. Locale strings use the same key paths in both en-US and zh-CN.
