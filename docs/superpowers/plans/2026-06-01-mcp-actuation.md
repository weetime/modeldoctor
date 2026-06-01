# MCP Actuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 MCP tools so Claude Code can investigate (PromQL, engine catalog, benchmark compare) and act (run benchmark / quality-gate, with dry-run + confirm) against a self-hosted inference fleet — closing the gap where the agent can list but not operate.

**Architecture:** Each tool is a thin `registerTool<Input>` wrapper delegating to an existing NestJS service (same business logic as REST). Execute tools (`run_benchmark`, `run_quality_gate`) use a stateless HMAC `ConfirmTokenService` for dry-run→confirm, gated behind `MCP_ALLOW_EXECUTE`. `query_prometheus` reuses the **secure** `PrometheusFetcherService` (bearer decrypt + SSRF guard + bounded read), NOT the auth-naive `PromClient`.

**Tech Stack:** NestJS 10 (CJS), Prisma, Zod, `@modelcontextprotocol/sdk`, Vitest (unit `*.spec.ts` + e2e `*.e2e-spec.ts` via testcontainer Postgres). Project is a bare+worktree layout; work happens in `apps/api`.

---

## Context the implementer needs

- **Tool pattern** (study before starting): `apps/api/src/modules/mcp/tools/run-diagnostics.tool.ts` (a delegate tool) and `tools/set-default-prometheus-datasource.tool.spec.ts` (the captured-handler test shim). Every tool is `export function registerX(server, deps: McpToolDeps)`, calls `registerTool<Input>(server, {name,title,description,inputShape}, async (input)=>...)`, returns `{ content:[{type:"text",text}], structuredContent }`.
- **Registration**: tools are wired in `apps/api/src/modules/mcp/mcp.service.ts` `handleRequest()` (the `registerXxx(server, deps)` block ~lines 119-133), and their service deps come from the `McpToolDeps` object (interface at bottom of `mcp.service.ts`).
- **Tests run** (from repo root or `apps/api`): unit `pnpm -F @modeldoctor/api test -- <path>`; e2e `pnpm -F @modeldoctor/api test:e2e:api`. First e2e run in this fresh worktree needs `pnpm -r build` once (so `packages/contracts/dist` exists) — run it before Task 10.
- **Commits**: conventional prefixes, explicit `git add <files>` (never `-A`), body ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. One commit per task. Single PR, phase-per-commit.
- **Confirmed signatures** (do not re-discover):
  - `BenchmarkService.create(userId: string, req: CreateBenchmarkRequest): Promise<Benchmark>` · `findByIdOrFail(id: string, userId?: string): Promise<Benchmark>` — `apps/api/src/modules/benchmark/benchmark.service.ts`
  - `RunsService.create(userId: string, body: CreateRunRequest): Promise<EvaluationRun>` · `get(userId: string, id: string): Promise<EvaluationRun>` — `apps/api/src/modules/quality-gate/services/runs.service.ts` (already exported by `QualityGateModule`)
  - `ConnectionService.getOwnedDecrypted(userId, connectionId)` returns a connection incl. `serverKind`, `model`, `prometheusDatasource`
  - `createBenchmarkRequestSchema` / `CreateBenchmarkRequest` · `createRunRequestSchema` / `CreateRunRequest` · `getEngineManifest(serverKind)` — all from `@modeldoctor/contracts`
  - Env: `ConfigService<Env, true>` with `this.config.get("KEY", { infer: true })`; `Env` from `apps/api/src/config/env.schema.js`. `envBoolean` helper exists in `env.schema.ts`.

---

## File Structure

**New files (`apps/api/src/modules/mcp/`):**
- `confirm-token.service.ts` + `confirm-token.service.spec.ts` — stateless HMAC dry-run→confirm
- `metrics-align.ts` + `metrics-align.spec.ts` — pure numeric flatten/align for compare
- `tools/query-prometheus.tool.ts` + `.spec.ts`
- `tools/get-engine-metric-catalog.tool.ts` + `.spec.ts`
- `tools/compare-benchmarks.tool.ts` + `.spec.ts`
- `tools/get-benchmark.tool.ts` + `.spec.ts`
- `tools/get-quality-gate-run.tool.ts` + `.spec.ts`
- `tools/run-benchmark.tool.ts` + `.spec.ts`
- `tools/run-quality-gate.tool.ts` + `.spec.ts`

**Modified files:**
- `apps/api/src/modules/alerts/prometheus-fetcher.service.ts` — add public `resolveDatasourceByRef()` + `runQuery()`
- `apps/api/src/modules/alerts/alerts.module.ts` — export `PrometheusFetcherService`
- `apps/api/src/config/env.schema.ts` + `apps/api/.env.example` — `MCP_ALLOW_EXECUTE`
- `apps/api/src/modules/mcp/mcp.module.ts` — add `QualityGateModule` import + `ConfirmTokenService` provider (the catalog tool needs no new module: it uses `getEngineManifest` from contracts + the already-imported `ConnectionModule`)
- `apps/api/src/modules/mcp/mcp.service.ts` — inject `RunsService`, `PrometheusFetcherService`, `ConfirmTokenService`, `ConfigService`; extend `McpToolDeps`; register 7 tools
- `apps/api/src/modules/mcp/README.md` — document 7 tools
- `apps/api/test/e2e/mcp.e2e-spec.ts` — registration + dry-run/confirm assertions

---

## Task 1: ConfirmTokenService (dry-run → confirm)

**Files:**
- Create: `apps/api/src/modules/mcp/confirm-token.service.ts`
- Test: `apps/api/src/modules/mcp/confirm-token.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/mcp/confirm-token.service.spec.ts
import { describe, expect, it } from "vitest";
import { ConfirmTokenService } from "./confirm-token.service.js";

function svc() {
  // ConfigService stub: only get("MCP_BEARER_TOKEN") is read.
  const config = { get: () => "x".repeat(40) } as unknown as ConstructorParameters<
    typeof ConfirmTokenService
  >[0];
  return new ConfirmTokenService(config);
}

const T0 = 1_750_000_000_000;

describe("ConfirmTokenService", () => {
  it("issues a token that verifies for the same action+payload", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { connectionId: "c1", tool: "guidellm" }, T0);
    expect(s.verify("run_benchmark", { connectionId: "c1", tool: "guidellm" }, token, T0)).toEqual({
      ok: true,
    });
  });

  it("is order-insensitive on payload keys (stable stringify)", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { a: 1, b: 2 }, T0);
    expect(s.verify("run_benchmark", { b: 2, a: 1 }, token, T0).ok).toBe(true);
  });

  it("rejects a changed payload", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { connectionId: "c1" }, T0);
    expect(s.verify("run_benchmark", { connectionId: "c2" }, token, T0).ok).toBe(false);
  });

  it("rejects a token issued for a different action", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { x: 1 }, T0);
    expect(s.verify("run_quality_gate", { x: 1 }, token, T0)).toEqual({
      ok: false,
      reason: "action_mismatch",
    });
  });

  it("reports signature_mismatch on a changed payload (not action/expiry)", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { connectionId: "c1" }, T0);
    expect(s.verify("run_benchmark", { connectionId: "c2" }, token, T0)).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects an expired token (> 10 min)", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { x: 1 }, T0);
    expect(s.verify("run_benchmark", { x: 1 }, token, T0 + 11 * 60_000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a malformed token", () => {
    const s = svc();
    expect(s.verify("run_benchmark", { x: 1 }, "not-a-token", T0).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- confirm-token.service.spec`
Expected: FAIL — `Cannot find module './confirm-token.service.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/modules/mcp/confirm-token.service.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";

const TTL_MS = 10 * 60_000;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Stateless dry-run→confirm tokens for execute-class MCP tools. The token
 * binds (action, canonical payload, issue time) under an HMAC keyed by
 * MCP_BEARER_TOKEN — so a token issued by a dry-run for one request cannot be
 * replayed against a different payload (agent can't swap small dry-run params
 * for big real ones) or after it expires. No DB, no revocation list.
 */
@Injectable()
export class ConfirmTokenService {
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    // MCP routes are 503 unless MCP_BEARER_TOKEN is set (see mcp.guard.ts), so
    // by the time any execute tool runs this is always present.
    this.secret = config.get("MCP_BEARER_TOKEN", { infer: true }) ?? "mcp-confirm-fallback";
  }

  issue(action: string, payload: unknown, nowMs: number = Date.now()): string {
    const ts = nowMs;
    const sig = this.sign(action, payload, ts);
    // Carry action + ts in the token so verify can distinguish a wrong-action
    // token from a tampered payload, and enforce expiry without a store.
    return Buffer.from(JSON.stringify({ action, ts, sig }), "utf8").toString("base64url");
  }

  verify(action: string, payload: unknown, token: string, nowMs: number = Date.now()): VerifyResult {
    let decoded: { action?: string; ts?: number; sig?: string };
    try {
      decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (typeof decoded.action !== "string" || typeof decoded.ts !== "number" || typeof decoded.sig !== "string") {
      return { ok: false, reason: "malformed" };
    }
    if (decoded.action !== action) return { ok: false, reason: "action_mismatch" };
    if (nowMs - decoded.ts > TTL_MS) return { ok: false, reason: "expired" };
    const expected = this.sign(decoded.action, payload, decoded.ts);
    const a = Buffer.from(decoded.sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "signature_mismatch" };
    }
    return { ok: true };
  }

  private sign(action: string, payload: unknown, ts: number): string {
    const body = `${action}\n${stableStringify(payload)}\n${ts}`;
    return createHmac("sha256", this.secret).update(body).digest("hex");
  }
}

/** Deterministic JSON: object keys sorted recursively so key order never
 * changes the signature. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @modeldoctor/api test -- confirm-token.service.spec`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/mcp/confirm-token.service.ts apps/api/src/modules/mcp/confirm-token.service.spec.ts
git commit -m "feat(mcp): stateless HMAC ConfirmTokenService for dry-run/confirm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extend PrometheusFetcherService with a reusable query surface

`query_prometheus` must run arbitrary PromQL against an admin-registered datasource using the **secure** fetch path (bearer decrypt + SSRF guard + bounded read) that already lives in `PrometheusFetcherService`. Add a public datasource resolver (by connectionId/datasourceId, not AlertEvent) and a public `runQuery` supporting instant + range.

**Files:**
- Modify: `apps/api/src/modules/alerts/prometheus-fetcher.service.ts`
- Modify: `apps/api/src/modules/alerts/alerts.module.ts`
- Test: `apps/api/src/modules/alerts/prometheus-fetcher.query.spec.ts` (new)

- [ ] **Step 1: Write the failing test** (exercises resolution + range/instant URL building via a mocked `fetch`)

```typescript
// apps/api/src/modules/alerts/prometheus-fetcher.query.spec.ts
import type { PrometheusDatasource } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrometheusFetcherService } from "./prometheus-fetcher.service.js";

const DS: PrometheusDatasource = {
  id: "ds1",
  name: "primary",
  baseUrl: "http://prom.local",
  bearerCipher: null,
  customHeaders: null,
  isDefault: true,
  // remaining columns are not read by runQuery; cast keeps the test focused.
} as unknown as PrometheusDatasource;

function makeService() {
  const prisma = {
    prometheusDatasource: { findUnique: vi.fn(), findFirst: vi.fn() },
    connection: { findUnique: vi.fn() },
  };
  const config = { guard: { allowPrivateTargets: true }, maxBodyBytes: 1_000_000 };
  const svc = new PrometheusFetcherService(
    prisma as never,
    Buffer.from("0".repeat(32)).toString("base64"),
    config as never,
  );
  return { svc, prisma };
}

afterEach(() => vi.restoreAllMocks());

describe("PrometheusFetcherService.runQuery", () => {
  it("hits /api/v1/query (instant) and maps the vector result", async () => {
    const { svc } = makeService();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            resultType: "vector",
            result: [{ metric: { job: "vllm" }, value: [1750000000, "0.42"] }],
          },
        }),
        { status: 200 },
      ),
    );
    const out = await svc.runQuery(DS, "up", { kind: "instant" });
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("/api/v1/query?");
    expect(out.truncated).toBe(false);
    expect(out.series[0]?.labels.job).toBe("vllm");
    expect(out.series[0]?.value).toBeCloseTo(0.42);
  });

  it("truncates series beyond the cap", async () => {
    const { svc } = makeService();
    const many = Array.from({ length: 50 }, (_, i) => ({
      metric: { i: String(i) },
      value: [1750000000, "1"],
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "success", data: { resultType: "vector", result: many } }),
        { status: 200 },
      ),
    );
    const out = await svc.runQuery(DS, "up", { kind: "instant" });
    expect(out.truncated).toBe(true);
    expect(out.series.length).toBeLessThanOrEqual(20);
  });

  it("resolveDatasourceByRef prefers datasourceId, then connection, then default", async () => {
    const { svc, prisma } = makeService();
    prisma.prometheusDatasource.findUnique.mockResolvedValue(DS);
    expect(await svc.resolveDatasourceByRef({ datasourceId: "ds1" })).toBe(DS);
    expect(prisma.prometheusDatasource.findUnique).toHaveBeenCalledWith({ where: { id: "ds1" } });

    prisma.connection.findUnique.mockResolvedValue({ prometheusDatasource: DS });
    expect(await svc.resolveDatasourceByRef({ connectionId: "c1" })).toBe(DS);

    prisma.connection.findUnique.mockResolvedValue({ prometheusDatasource: null });
    prisma.prometheusDatasource.findFirst.mockResolvedValue(DS);
    expect(await svc.resolveDatasourceByRef({ connectionId: "c1" })).toBe(DS);
    expect(prisma.prometheusDatasource.findFirst).toHaveBeenCalledWith({
      where: { isDefault: true },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- prometheus-fetcher.query.spec`
Expected: FAIL — `svc.runQuery is not a function` / `resolveDatasourceByRef is not a function`.

- [ ] **Step 3: Add the public methods to `prometheus-fetcher.service.ts`**

Add these constants near the existing ones (after line 36 `MAX_SERIES`):

```typescript
const MAX_QUERY_SERIES = 20;
const MAX_SAMPLES_PER_SERIES = 120;
```

Add the public result type next to `PromContext` (after line 27):

```typescript
export interface PromQueryResult {
  datasource: { id: string; name: string };
  query: string;
  kind: "instant" | "range";
  truncated: boolean;
  series: Array<{
    labels: Record<string, string>;
    /** instant queries carry a single `value`; range queries carry `samples`. */
    value?: number;
    samples?: Array<{ at: string; value: number }>;
  }>;
}

export type PromQueryOpts =
  | { kind: "instant"; at?: Date }
  | { kind: "range"; from: Date; to: Date; step: number };
```

Add these public methods inside the class (e.g. after `_test_resolveExpr`):

```typescript
  /** Resolve a datasource for an MCP query by explicit id, by a connection's
   * binding, or the workspace default. Mirrors the alert-path precedence. */
  async resolveDatasourceByRef(ref: {
    datasourceId?: string;
    connectionId?: string;
  }): Promise<PrometheusDatasource | null> {
    if (ref.datasourceId) {
      return this.prisma.prometheusDatasource.findUnique({ where: { id: ref.datasourceId } });
    }
    if (ref.connectionId) {
      const conn = await this.prisma.connection.findUnique({
        where: { id: ref.connectionId },
        include: { prometheusDatasource: true },
      });
      if (conn?.prometheusDatasource) return conn.prometheusDatasource;
    }
    return this.prisma.prometheusDatasource.findFirst({ where: { isDefault: true } });
  }

  /** Run an arbitrary read-only PromQL query through the same secured fetch
   * path as alert grounding (bearer decrypt + SSRF guard + bounded read). */
  async runQuery(
    ds: PrometheusDatasource,
    query: string,
    opts: PromQueryOpts,
  ): Promise<PromQueryResult> {
    const base = ds.baseUrl.replace(/\/$/, "");
    const url =
      opts.kind === "instant"
        ? new URL(`${base}/api/v1/query`)
        : new URL(`${base}/api/v1/query_range`);
    url.searchParams.set("query", query);
    if (opts.kind === "instant") {
      url.searchParams.set("time", String(Math.floor((opts.at ?? new Date()).getTime() / 1000)));
    } else {
      url.searchParams.set("start", String(Math.floor(opts.from.getTime() / 1000)));
      url.searchParams.set("end", String(Math.floor(opts.to.getTime() / 1000)));
      url.searchParams.set("step", String(opts.step));
    }

    const headers = this.buildAuthHeaders(ds);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.safeFetch(url, { headers }, controller.signal);
      if (!res.ok) throw new Error(`prom ${res.status}`);
      const body = (await this.readBoundedJson(res)) as {
        status: string;
        data?: { resultType: string; result?: Array<Record<string, unknown>> };
      } | null;
      if (!body || body.status !== "success" || !body.data?.result) {
        return { datasource: { id: ds.id, name: ds.name }, query, kind: opts.kind, truncated: false, series: [] };
      }
      const raw = body.data.result;
      const truncated = raw.length > MAX_QUERY_SERIES;
      const series = raw.slice(0, MAX_QUERY_SERIES).map((row) => {
        const labels = (row.metric as Record<string, string>) ?? {};
        if (opts.kind === "instant") {
          const v = (row.value as [number, string] | undefined)?.[1];
          return { labels, value: v === undefined ? Number.NaN : Number(v) };
        }
        const values = (row.values as Array<[number, string]> | undefined) ?? [];
        return {
          labels,
          samples: values.slice(-MAX_SAMPLES_PER_SERIES).map(([ts, v]) => ({
            at: new Date(ts * 1000).toISOString(),
            value: Number(v),
          })),
        };
      });
      return { datasource: { id: ds.id, name: ds.name }, query, kind: opts.kind, truncated, series };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Shared bearer-decrypt + custom-header assembly (extracted from the
   * private alert queryRange so both paths stay in sync). */
  private buildAuthHeaders(ds: PrometheusDatasource): Record<string, string> {
    const headers: Record<string, string> = {};
    if (ds.bearerCipher) {
      headers.Authorization = `Bearer ${decrypt(ds.bearerCipher, this.key)}`;
    }
    const extra = parseCustomHeaders(ds.customHeaders);
    if (extra) Object.assign(headers, extra);
    return headers;
  }
```

(Leave the existing private `queryRange` as-is for the alert path; `runQuery` is the new public surface. `decrypt`, `parseCustomHeaders`, `safeFetch`, `readBoundedJson`, `TIMEOUT_MS` are already imported/defined in this file.)

- [ ] **Step 4: Export the service from AlertsModule**

In `apps/api/src/modules/alerts/alerts.module.ts`, add `PrometheusFetcherService` to the `exports: [...]` array (it is already a provider).

- [ ] **Step 5: Run tests**

Run: `pnpm -F @modeldoctor/api test -- prometheus-fetcher`
Expected: PASS (new query spec + existing fetcher spec still green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/alerts/prometheus-fetcher.service.ts apps/api/src/modules/alerts/prometheus-fetcher.query.spec.ts apps/api/src/modules/alerts/alerts.module.ts
git commit -m "feat(alerts): public runQuery + datasource-by-ref on PrometheusFetcherService

Reusable secured PromQL surface (bearer decrypt + SSRF guard + bounded read)
for the MCP query_prometheus tool. Alert grounding path unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `query_prometheus` tool + wiring

**Files:**
- Create: `apps/api/src/modules/mcp/tools/query-prometheus.tool.ts`
- Test: `apps/api/src/modules/mcp/tools/query-prometheus.tool.spec.ts`
- Modify: `mcp.service.ts` (deps + registration), `mcp.module.ts` (already imports AlertsModule — no change needed for this service)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/mcp/tools/query-prometheus.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerQueryPrometheus } from "./query-prometheus.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _meta: unknown, handler: unknown) =>
      calls.push({ name, handler: handler as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("query_prometheus tool", () => {
  it("registers under the expected name", () => {
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, {} as McpToolDeps);
    expect(calls[0]?.name).toBe("query_prometheus");
  });

  it("resolves the datasource then runs the query", async () => {
    const ds = { id: "ds1", name: "p" };
    const resolveDatasourceByRef = vi.fn().mockResolvedValue(ds);
    const runQuery = vi
      .fn()
      .mockResolvedValue({ datasource: ds, query: "up", kind: "instant", truncated: false, series: [] });
    const deps = { promFetcher: { resolveDatasourceByRef, runQuery } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, deps);

    const out = (await calls[0]?.handler({ connectionId: "c1", query: "up" })) as {
      structuredContent: { kind: string };
    };
    expect(resolveDatasourceByRef).toHaveBeenCalledWith({ connectionId: "c1", datasourceId: undefined });
    expect(runQuery).toHaveBeenCalledWith(ds, "up", { kind: "instant" });
    expect(out.structuredContent.kind).toBe("instant");
  });

  it("returns isError when no datasource resolves", async () => {
    const deps = {
      promFetcher: { resolveDatasourceByRef: vi.fn().mockResolvedValue(null), runQuery: vi.fn() },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, deps);
    const out = (await calls[0]?.handler({ query: "up" })) as { isError?: boolean };
    expect(out.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- query-prometheus.tool.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

```typescript
// apps/api/src/modules/mcp/tools/query-prometheus.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type QueryPrometheusInput = {
  query: string;
  connectionId?: string;
  datasourceId?: string;
  range?: { from: string; to: string; step?: number };
};

export function registerQueryPrometheus(server: McpServer, deps: McpToolDeps): void {
  registerTool<QueryPrometheusInput>(
    server,
    {
      name: "query_prometheus",
      title: "Run a PromQL query",
      description:
        "Run a read-only PromQL query against a registered Prometheus datasource. " +
        "Resolve the datasource by `datasourceId`, or by `connectionId` (its bound " +
        "datasource, else the workspace default). Omit `range` for an instant query; " +
        "supply `range` {from,to ISO, step seconds} for a range query. Results are " +
        "capped (≤20 series); use get_engine_metric_catalog first to learn the " +
        "engine's metric names. Tokens/bearers stay server-side.",
      inputShape: {
        query: z.string().min(1).describe("PromQL expression."),
        connectionId: z
          .string()
          .optional()
          .describe("Resolve the datasource bound to this connection (or default)."),
        datasourceId: z.string().optional().describe("Explicit Prometheus datasource id."),
        range: z
          .object({
            from: z.string().describe("ISO start time."),
            to: z.string().describe("ISO end time."),
            step: z.number().int().min(1).max(3600).default(30).describe("Step seconds."),
          })
          .optional()
          .describe("Omit for an instant query."),
      },
    },
    async (input) => {
      const ds = await deps.promFetcher.resolveDatasourceByRef({
        connectionId: input.connectionId,
        datasourceId: input.datasourceId,
      });
      if (!ds) {
        return {
          content: [
            {
              type: "text",
              text: "No Prometheus datasource resolved. Pass datasourceId, or a connectionId with a bound datasource, or configure a default.",
            },
          ],
          isError: true,
        };
      }
      const result = input.range
        ? await deps.promFetcher.runQuery(ds, input.query, {
            kind: "range",
            from: new Date(input.range.from),
            to: new Date(input.range.to),
            step: input.range.step ?? 30,
          })
        : await deps.promFetcher.runQuery(ds, input.query, { kind: "instant" });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 4: Wire into mcp.service.ts**

In `apps/api/src/modules/mcp/mcp.service.ts`:
1. Import: `import { PrometheusFetcherService } from "../alerts/prometheus-fetcher.service.js";` and `import { registerQueryPrometheus } from "./tools/query-prometheus.tool.js";`
2. Constructor param: add `private readonly promFetcher: PrometheusFetcherService,`
3. In the `deps` object: add `promFetcher: this.promFetcher,`
4. In `McpToolDeps` interface: add `promFetcher: PrometheusFetcherService;`
5. After the existing `registerXxx(server, deps)` block: add `registerQueryPrometheus(server, deps);`

(No `mcp.module.ts` change: `AlertsModule` is already imported and now exports `PrometheusFetcherService`.)

- [ ] **Step 5: Run tests**

Run: `pnpm -F @modeldoctor/api test -- query-prometheus.tool.spec`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck (wiring touches DI)**

Run: `pnpm -F @modeldoctor/api type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/mcp/tools/query-prometheus.tool.ts apps/api/src/modules/mcp/tools/query-prometheus.tool.spec.ts apps/api/src/modules/mcp/mcp.service.ts
git commit -m "feat(mcp): query_prometheus tool (read-only PromQL passthrough)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `get_engine_metric_catalog` tool

Returns the per-serverKind metric manifest so the agent knows which metric names/PromQL to use with `query_prometheus`.

**Files:**
- Create: `apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.ts`
- Test: `apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.spec.ts`
- Modify: `mcp.service.ts` (registration only — uses existing `deps.connections`)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerGetEngineMetricCatalog } from "./get-engine-metric-catalog.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("get_engine_metric_catalog tool", () => {
  it("registers under the expected name", () => {
    const { server, calls } = makeServer();
    registerGetEngineMetricCatalog(server, {} as McpToolDeps);
    expect(calls[0]?.name).toBe("get_engine_metric_catalog");
  });

  it("returns the manifest for the connection's serverKind", async () => {
    const getOwnedDecrypted = vi.fn().mockResolvedValue({ serverKind: "vllm" });
    const deps = { userId: "u1", connections: { getOwnedDecrypted } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetEngineMetricCatalog(server, deps);
    const out = (await calls[0]?.handler({ connectionId: "c1" })) as {
      structuredContent: { engineId?: string; metrics?: unknown[] };
    };
    expect(getOwnedDecrypted).toHaveBeenCalledWith("u1", "c1");
    expect(out.structuredContent.engineId).toBe("vllm");
    expect(Array.isArray(out.structuredContent.metrics)).toBe(true);
  });

  it("returns isError when the connection has no manifest", async () => {
    const deps = {
      userId: "u1",
      connections: { getOwnedDecrypted: vi.fn().mockResolvedValue({ serverKind: null }) },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetEngineMetricCatalog(server, deps);
    const out = (await calls[0]?.handler({ connectionId: "c1" })) as { isError?: boolean };
    expect(out.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- get-engine-metric-catalog.tool.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

```typescript
// apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getEngineManifest } from "@modeldoctor/contracts";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { connectionId: string };

export function registerGetEngineMetricCatalog(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "get_engine_metric_catalog",
      title: "Get a connection's engine metric catalog",
      description:
        "Return the metric catalog (metric keys, units, PromQL templates, thresholds) " +
        "for the inference engine behind a connection (vLLM / SGLang / TGI / TEI / MindIE). " +
        "Use this BEFORE query_prometheus so you know the engine's real metric names " +
        "instead of guessing.",
      inputShape: {
        connectionId: z.string().min(1).describe("Saved connection id. See list_connections."),
      },
    },
    async (input) => {
      const conn = await deps.connections.getOwnedDecrypted(deps.userId, input.connectionId);
      const manifest = conn.serverKind ? getEngineManifest(conn.serverKind as never) : null;
      if (!manifest) {
        return {
          content: [
            {
              type: "text",
              text: `No engine metric catalog for serverKind=${conn.serverKind ?? "(unset)"}. Set the connection's serverKind to one of: vllm, sglang, tgi, tei, mindie.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }],
        structuredContent: manifest as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 4: Wire into mcp.service.ts**

Import `registerGetEngineMetricCatalog` and add `registerGetEngineMetricCatalog(server, deps);` to the registration block. (Uses existing `deps.connections` — no new dep.)

- [ ] **Step 5: Run tests**

Run: `pnpm -F @modeldoctor/api test -- get-engine-metric-catalog.tool.spec`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.ts apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.spec.ts apps/api/src/modules/mcp/mcp.service.ts
git commit -m "feat(mcp): get_engine_metric_catalog tool (per-engine PromQL catalog)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `compare_benchmarks` (metrics-align helper + tool)

No benchmark-to-benchmark comparator exists. Build a tool-agnostic numeric aligner: flatten each benchmark's `summaryMetrics` to numeric dot-paths, align across benchmarks. Direction-of-good is left to the agent (we only emit values).

**Files:**
- Create: `apps/api/src/modules/mcp/metrics-align.ts` + `.spec.ts`
- Create: `apps/api/src/modules/mcp/tools/compare-benchmarks.tool.ts` + `.spec.ts`
- Modify: `mcp.service.ts` (registration — uses existing `deps.benchmarks`)

- [ ] **Step 1: Write the failing test for the helper**

```typescript
// apps/api/src/modules/mcp/metrics-align.spec.ts
import { describe, expect, it } from "vitest";
import { alignBenchmarkMetrics, flattenNumeric } from "./metrics-align.js";

describe("flattenNumeric", () => {
  it("flattens nested numeric leaves to dot paths, ignoring non-numbers", () => {
    expect(flattenNumeric({ e2e: { p95: 1200, label: "x" }, tps: 30 })).toEqual({
      "e2e.p95": 1200,
      tps: 30,
    });
  });
  it("returns {} for null/non-object", () => {
    expect(flattenNumeric(null)).toEqual({});
    expect(flattenNumeric(42)).toEqual({});
  });
});

describe("alignBenchmarkMetrics", () => {
  it("aligns shared + disjoint metric keys across benchmarks", () => {
    const out = alignBenchmarkMetrics([
      { id: "b1", name: "A", summaryMetrics: { "e2e.p95": 100, tps: 30 } },
      { id: "b2", name: "B", summaryMetrics: { "e2e.p95": 120, errRate: 0.01 } },
    ]);
    expect(out.benchmarks).toEqual([
      { id: "b1", name: "A" },
      { id: "b2", name: "B" },
    ]);
    const p95 = out.rows.find((r) => r.metric === "e2e.p95");
    expect(p95?.values).toEqual([100, 120]);
    const err = out.rows.find((r) => r.metric === "errRate");
    expect(err?.values).toEqual([null, 0.01]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- metrics-align.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

```typescript
// apps/api/src/modules/mcp/metrics-align.ts
/** Flatten an arbitrary summaryMetrics object to numeric leaves keyed by dot
 * path. Non-numeric / non-finite leaves are dropped. */
export function flattenNumeric(obj: unknown, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (obj == null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) out[path] = v;
    else if (v && typeof v === "object") Object.assign(out, flattenNumeric(v, path));
  }
  return out;
}

export interface AlignedComparison {
  benchmarks: Array<{ id: string; name: string }>;
  rows: Array<{ metric: string; values: Array<number | null> }>;
}

/** Tool-agnostic alignment: union of all numeric metric paths, one row per
 * metric with a value (or null) per benchmark, in input order. Direction of
 * "better" is intentionally NOT inferred — the caller (agent) judges it. */
export function alignBenchmarkMetrics(
  items: Array<{ id: string; name: string; summaryMetrics: unknown }>,
): AlignedComparison {
  const flats = items.map((i) => ({ id: i.id, name: i.name, m: flattenNumeric(i.summaryMetrics) }));
  const keys = Array.from(new Set(flats.flatMap((f) => Object.keys(f.m)))).sort();
  return {
    benchmarks: flats.map((f) => ({ id: f.id, name: f.name })),
    rows: keys.map((metric) => ({ metric, values: flats.map((f) => f.m[metric] ?? null) })),
  };
}
```

- [ ] **Step 4: Run helper test**

Run: `pnpm -F @modeldoctor/api test -- metrics-align.spec`
Expected: PASS (4 assertions).

- [ ] **Step 5: Write the failing tool test**

```typescript
// apps/api/src/modules/mcp/tools/compare-benchmarks.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerCompareBenchmarks } from "./compare-benchmarks.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("compare_benchmarks tool", () => {
  it("fetches each benchmark (owner-scoped) and returns an aligned table", async () => {
    const findByIdOrFail = vi
      .fn()
      .mockResolvedValueOnce({ id: "b1", name: "A", summaryMetrics: { "e2e.p95": 100 } })
      .mockResolvedValueOnce({ id: "b2", name: "B", summaryMetrics: { "e2e.p95": 120 } });
    const deps = { userId: "u1", benchmarks: { findByIdOrFail } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerCompareBenchmarks(server, deps);
    const out = (await calls[0]?.handler({ benchmarkIds: ["b1", "b2"] })) as {
      structuredContent: { rows: Array<{ metric: string; values: unknown[] }> };
    };
    expect(findByIdOrFail).toHaveBeenCalledWith("b1", "u1");
    expect(findByIdOrFail).toHaveBeenCalledWith("b2", "u1");
    expect(out.structuredContent.rows[0]).toEqual({ metric: "e2e.p95", values: [100, 120] });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- compare-benchmarks.tool.spec`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the tool**

```typescript
// apps/api/src/modules/mcp/tools/compare-benchmarks.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { alignBenchmarkMetrics } from "../metrics-align.js";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { benchmarkIds: string[] };

export function registerCompareBenchmarks(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "compare_benchmarks",
      title: "Compare benchmark metrics side by side",
      description:
        "Align the summary metrics of 2–5 benchmark runs into one table (one row per " +
        "metric, one column per run). Tool-agnostic: every numeric metric is surfaced; " +
        "you decide which direction is 'better'. Use list_benchmarks to find ids.",
      inputShape: {
        benchmarkIds: z
          .array(z.string().min(1))
          .min(2)
          .max(5)
          .describe("2–5 benchmark ids to align."),
      },
    },
    async (input) => {
      const items = await Promise.all(
        input.benchmarkIds.map((id) => deps.benchmarks.findByIdOrFail(id, deps.userId)),
      );
      const aligned = alignBenchmarkMetrics(
        items.map((b) => ({ id: b.id, name: b.name, summaryMetrics: b.summaryMetrics })),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(aligned, null, 2) }],
        structuredContent: aligned as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 8: Wire into mcp.service.ts**

Import `registerCompareBenchmarks` and add `registerCompareBenchmarks(server, deps);` to the registration block. (Uses existing `deps.benchmarks`.)

- [ ] **Step 9: Run tests**

Run: `pnpm -F @modeldoctor/api test -- "metrics-align|compare-benchmarks"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/mcp/metrics-align.ts apps/api/src/modules/mcp/metrics-align.spec.ts apps/api/src/modules/mcp/tools/compare-benchmarks.tool.ts apps/api/src/modules/mcp/tools/compare-benchmarks.tool.spec.ts apps/api/src/modules/mcp/mcp.service.ts
git commit -m "feat(mcp): compare_benchmarks tool (tool-agnostic metric alignment)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `get_benchmark` + `get_quality_gate_run` (poll tools) + QualityGateModule wiring

Execute tools are async; these let the agent poll a run to terminal state.

**Files:**
- Create: `apps/api/src/modules/mcp/tools/get-benchmark.tool.ts` + `.spec.ts`
- Create: `apps/api/src/modules/mcp/tools/get-quality-gate-run.tool.ts` + `.spec.ts`
- Modify: `mcp.module.ts` (import `QualityGateModule`), `mcp.service.ts` (inject `RunsService`, deps, register both)

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/modules/mcp/tools/get-benchmark.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerGetBenchmark } from "./get-benchmark.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("get_benchmark tool", () => {
  it("fetches a single benchmark owner-scoped", async () => {
    const findByIdOrFail = vi.fn().mockResolvedValue({ id: "b1", status: "completed" });
    const deps = { userId: "u1", benchmarks: { findByIdOrFail } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetBenchmark(server, deps);
    expect(calls[0]?.name).toBe("get_benchmark");
    const out = (await calls[0]?.handler({ benchmarkId: "b1" })) as {
      structuredContent: { status: string };
    };
    expect(findByIdOrFail).toHaveBeenCalledWith("b1", "u1");
    expect(out.structuredContent.status).toBe("completed");
  });
});
```

```typescript
// apps/api/src/modules/mcp/tools/get-quality-gate-run.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerGetQualityGateRun } from "./get-quality-gate-run.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("get_quality_gate_run tool", () => {
  it("fetches a single run owner-scoped", async () => {
    const get = vi.fn().mockResolvedValue({ id: "r1", status: "COMPLETED", gateResult: "PASSED" });
    const deps = { userId: "u1", runs: { get } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetQualityGateRun(server, deps);
    expect(calls[0]?.name).toBe("get_quality_gate_run");
    const out = (await calls[0]?.handler({ runId: "r1" })) as {
      structuredContent: { gateResult: string };
    };
    expect(get).toHaveBeenCalledWith("u1", "r1");
    expect(out.structuredContent.gateResult).toBe("PASSED");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @modeldoctor/api test -- "get-benchmark.tool.spec|get-quality-gate-run.tool.spec"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the tools**

```typescript
// apps/api/src/modules/mcp/tools/get-benchmark.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { benchmarkId: string };

export function registerGetBenchmark(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "get_benchmark",
      title: "Get a single benchmark",
      description:
        "Fetch one benchmark by id (status, scenario, tool, summaryMetrics). Use this to " +
        "poll a run started with run_benchmark until status is terminal " +
        "(completed/failed/cancelled).",
      inputShape: { benchmarkId: z.string().min(1).describe("Benchmark id.") },
    },
    async (input) => {
      const b = await deps.benchmarks.findByIdOrFail(input.benchmarkId, deps.userId);
      return {
        content: [{ type: "text", text: JSON.stringify(b, null, 2) }],
        structuredContent: b as unknown as Record<string, unknown>,
      };
    },
  );
}
```

```typescript
// apps/api/src/modules/mcp/tools/get-quality-gate-run.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { runId: string };

export function registerGetQualityGateRun(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "get_quality_gate_run",
      title: "Get a single quality-gate run",
      description:
        "Fetch one quality-gate run by id (status, gateResult, aggregate metrics, " +
        "processed/total samples). Use this to poll a run started with run_quality_gate " +
        "until status is terminal.",
      inputShape: { runId: z.string().min(1).describe("Evaluation run id.") },
    },
    async (input) => {
      const r = await deps.runs.get(deps.userId, input.runId);
      return {
        content: [{ type: "text", text: JSON.stringify(r, null, 2) }],
        structuredContent: r as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 4: Wire QualityGateModule + RunsService into mcp**

In `apps/api/src/modules/mcp/mcp.module.ts`: add `QualityGateModule` to the `imports` array (import it: `import { QualityGateModule } from "../quality-gate/quality-gate.module.js";`).

In `apps/api/src/modules/mcp/mcp.service.ts`:
1. Import `RunsService` (`import { RunsService } from "../quality-gate/services/runs.service.js";`) and both `registerGetBenchmark`, `registerGetQualityGateRun`.
2. Constructor param: add `private readonly runs: RunsService,`
3. `deps` object: add `runs: this.runs,`
4. `McpToolDeps` interface: add `runs: RunsService;`
5. Registration block: add `registerGetBenchmark(server, deps);` and `registerGetQualityGateRun(server, deps);`

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -F @modeldoctor/api test -- "get-benchmark.tool.spec|get-quality-gate-run.tool.spec"` → PASS
Run: `pnpm -F @modeldoctor/api type-check` → no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/mcp/tools/get-benchmark.tool.ts apps/api/src/modules/mcp/tools/get-benchmark.tool.spec.ts apps/api/src/modules/mcp/tools/get-quality-gate-run.tool.ts apps/api/src/modules/mcp/tools/get-quality-gate-run.tool.spec.ts apps/api/src/modules/mcp/mcp.module.ts apps/api/src/modules/mcp/mcp.service.ts
git commit -m "feat(mcp): get_benchmark + get_quality_gate_run poll tools

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `MCP_ALLOW_EXECUTE` env var

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Add to env schema**

In `apps/api/src/config/env.schema.ts`, in the `EnvSchema` object near the other `MCP_*` keys (`MCP_BEARER_TOKEN`, `MCP_USER_ID`), add:

```typescript
  MCP_ALLOW_EXECUTE: envBoolean.default(true),
```

(`envBoolean` is the existing helper in this file that accepts boolean or `"true"`/`"false"` strings.)

- [ ] **Step 2: Add to .env.example**

In `apps/api/.env.example`, under the `# --- MCP server (V1)` section, add:

```bash
# Allow execute-class MCP tools (run_benchmark / run_quality_gate). These use a
# dry-run + confirm-token handshake, but still let an agent spend GPU. Set to
# false for a read-only MCP deployment.
MCP_ALLOW_EXECUTE=true
```

- [ ] **Step 3: Verify the env-example sync check passes**

Run: `pnpm -F @modeldoctor/api check:env-example`
Expected: PASS (no drift between `env.schema.ts` and `.env.example`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config/env.schema.ts apps/api/.env.example
git commit -m "feat(api): MCP_ALLOW_EXECUTE env flag for execute-class MCP tools

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `run_benchmark` (execute, dry-run + confirm, gated)

**Files:**
- Create: `apps/api/src/modules/mcp/tools/run-benchmark.tool.ts` + `.spec.ts`
- Modify: `mcp.service.ts` (inject `ConfirmTokenService` + `ConfigService`, deps `confirmTokens` + `allowExecute`, gated registration)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/mcp/tools/run-benchmark.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerRunBenchmark } from "./run-benchmark.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

const REQ = {
  scenario: "inference",
  tool: "guidellm",
  connectionId: "c1",
  name: "agent run",
  params: {},
};

describe("run_benchmark tool", () => {
  it("dry-run (no token) returns a plan + confirmToken and does NOT create", async () => {
    const create = vi.fn();
    const issue = vi.fn().mockReturnValue("TOKEN123");
    const deps = {
      userId: "u1",
      benchmarks: { create },
      confirmTokens: { issue, verify: vi.fn() },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunBenchmark(server, deps);
    const out = (await calls[0]?.handler(REQ)) as {
      structuredContent: { dryRun: boolean; confirmToken: string };
    };
    expect(create).not.toHaveBeenCalled();
    expect(issue).toHaveBeenCalledWith("run_benchmark", REQ);
    expect(out.structuredContent.dryRun).toBe(true);
    expect(out.structuredContent.confirmToken).toBe("TOKEN123");
  });

  it("confirm (valid token) creates the benchmark", async () => {
    const create = vi.fn().mockResolvedValue({ id: "b1", status: "running" });
    const verify = vi.fn().mockReturnValue({ ok: true });
    const deps = {
      userId: "u1",
      benchmarks: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunBenchmark(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "TOKEN123" })) as {
      structuredContent: { id: string };
    };
    expect(verify).toHaveBeenCalledWith("run_benchmark", REQ, "TOKEN123");
    expect(create).toHaveBeenCalledWith("u1", REQ);
    expect(out.structuredContent.id).toBe("b1");
  });

  it("confirm (bad token) returns isError and does NOT create", async () => {
    const create = vi.fn();
    const verify = vi.fn().mockReturnValue({ ok: false, reason: "expired" });
    const deps = {
      userId: "u1",
      benchmarks: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunBenchmark(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "BAD" })) as { isError?: boolean };
    expect(create).not.toHaveBeenCalled();
    expect(out.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- run-benchmark.tool.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

```typescript
// apps/api/src/modules/mcp/tools/run-benchmark.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createBenchmarkRequestSchema } from "@modeldoctor/contracts";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

// Tool input = the REST create contract + an optional confirmToken. The
// request bound into the token is the create contract WITHOUT confirmToken.
type RunBenchmarkInput = z.infer<typeof createBenchmarkRequestSchema> & {
  confirmToken?: string;
};

export function registerRunBenchmark(server: McpServer, deps: McpToolDeps): void {
  registerTool<RunBenchmarkInput>(
    server,
    {
      name: "run_benchmark",
      title: "Run a benchmark (dry-run + confirm)",
      description:
        "Start a benchmark run. TWO-STEP: call once WITHOUT confirmToken to get a plan " +
        "(resolved params + a confirmToken); call again WITH that confirmToken and the " +
        "SAME params to actually create the run (this dispatches a Kubernetes Job and " +
        "consumes GPU). Poll status with get_benchmark. Token binds the exact params and " +
        "expires in 10 minutes.",
      inputShape: {
        scenario: z.string().describe("inference | capacity | gateway | prefix-cache-validation | kv-cache-stress"),
        tool: z.string().describe("guidellm | vegeta | prefix-cache-probe | evalscope | aiperf"),
        connectionId: z.string().min(1).describe("Target connection id."),
        name: z.string().min(1).max(128).describe("Run name."),
        params: z.record(z.unknown()).describe("Tool/scenario params (see a template or the web create form)."),
        templateId: z.string().optional(),
        baselineId: z.string().optional(),
        confirmToken: z.string().optional().describe("Omit for dry-run; supply to execute."),
      },
    },
    async (input) => {
      const { confirmToken, ...rest } = input;
      // Validate/normalize against the REST contract so the bound request and
      // the executed request are identical and contract-valid.
      const req = createBenchmarkRequestSchema.parse(rest);

      if (!confirmToken) {
        const token = deps.confirmTokens.issue("run_benchmark", req);
        const plan = {
          dryRun: true,
          willCreate: "benchmark (Kubernetes Job, consumes GPU)",
          target: { connectionId: req.connectionId, scenario: req.scenario, tool: req.tool },
          request: req,
          confirmToken: token,
          note: "Re-call run_benchmark with the SAME params plus this confirmToken to execute.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
          structuredContent: plan as unknown as Record<string, unknown>,
        };
      }

      const verdict = deps.confirmTokens.verify("run_benchmark", req, confirmToken);
      if (!verdict.ok) {
        return {
          content: [
            {
              type: "text",
              text: `confirmToken invalid (${verdict.reason}). Re-run the dry-run to get a fresh token; params must match exactly.`,
            },
          ],
          isError: true,
        };
      }
      const created = await deps.benchmarks.create(deps.userId, req);
      return {
        content: [{ type: "text", text: JSON.stringify(created, null, 2) }],
        structuredContent: created as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 4: Wire (inject ConfirmTokenService + ConfigService, gated registration)**

In `apps/api/src/modules/mcp/mcp.service.ts`:
1. Imports: `import { ConfigService } from "@nestjs/config";`, `import type { Env } from "../../config/env.schema.js";`, `import { ConfirmTokenService } from "./confirm-token.service.js";`, `import { registerRunBenchmark } from "./tools/run-benchmark.tool.js";`
2. Constructor params: add `private readonly confirmTokens: ConfirmTokenService,` and `private readonly config: ConfigService<Env, true>,`
3. Compute the flag at the top of `handleRequest` (before building `deps`): `const allowExecute = this.config.get("MCP_ALLOW_EXECUTE", { infer: true });`
4. `deps` object: add `confirmTokens: this.confirmTokens,` and `allowExecute,`
5. `McpToolDeps` interface: add `confirmTokens: ConfirmTokenService;` and `allowExecute: boolean;` (plus the `ConfirmTokenService` issue/verify shape is the real class — no separate type needed).
6. Gated registration, after the read tools:
```typescript
    if (deps.allowExecute) {
      registerRunBenchmark(server, deps);
    }
```

In `apps/api/src/modules/mcp/mcp.module.ts`: add `ConfirmTokenService` to `providers`. (`ConfigModule` is global in this app — already available; confirm by checking other services inject `ConfigService` without importing `ConfigModule` here, as `mcp.guard.ts` does.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -F @modeldoctor/api test -- run-benchmark.tool.spec` → PASS (3 tests)
Run: `pnpm -F @modeldoctor/api type-check` → no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/mcp/tools/run-benchmark.tool.ts apps/api/src/modules/mcp/tools/run-benchmark.tool.spec.ts apps/api/src/modules/mcp/mcp.service.ts apps/api/src/modules/mcp/mcp.module.ts
git commit -m "feat(mcp): run_benchmark tool (dry-run + confirm, MCP_ALLOW_EXECUTE-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `run_quality_gate` (execute, dry-run + confirm, gated)

**Files:**
- Create: `apps/api/src/modules/mcp/tools/run-quality-gate.tool.ts` + `.spec.ts`
- Modify: `mcp.service.ts` (register, gated)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/mcp/tools/run-quality-gate.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerRunQualityGate } from "./run-quality-gate.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

const REQ = { evaluationId: "e1", endpointAId: "c1", gateConfig: { passRateMin: 0.8 } };

describe("run_quality_gate tool", () => {
  it("dry-run returns a plan + token and does NOT create", async () => {
    const create = vi.fn();
    const issue = vi.fn().mockReturnValue("TOK");
    const deps = {
      userId: "u1",
      runs: { create },
      confirmTokens: { issue, verify: vi.fn() },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunQualityGate(server, deps);
    const out = (await calls[0]?.handler(REQ)) as { structuredContent: { dryRun: boolean } };
    expect(create).not.toHaveBeenCalled();
    expect(issue).toHaveBeenCalledWith("run_quality_gate", REQ);
    expect(out.structuredContent.dryRun).toBe(true);
  });

  it("confirm with valid token creates the run", async () => {
    const create = vi.fn().mockResolvedValue({ id: "r1", status: "PENDING" });
    const verify = vi.fn().mockReturnValue({ ok: true });
    const deps = {
      userId: "u1",
      runs: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunQualityGate(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "TOK" })) as {
      structuredContent: { id: string };
    };
    expect(verify).toHaveBeenCalledWith("run_quality_gate", REQ, "TOK");
    expect(create).toHaveBeenCalledWith("u1", REQ);
    expect(out.structuredContent.id).toBe("r1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/api test -- run-quality-gate.tool.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the tool**

```typescript
// apps/api/src/modules/mcp/tools/run-quality-gate.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRunRequestSchema } from "@modeldoctor/contracts";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type RunQualityGateInput = z.infer<typeof createRunRequestSchema> & { confirmToken?: string };

export function registerRunQualityGate(server: McpServer, deps: McpToolDeps): void {
  registerTool<RunQualityGateInput>(
    server,
    {
      name: "run_quality_gate",
      title: "Run a quality-gate evaluation (dry-run + confirm)",
      description:
        "Start a quality-gate run for an evaluation against endpoint A (and optional B). " +
        "TWO-STEP: call WITHOUT confirmToken to get a plan + confirmToken; call again WITH " +
        "the token and SAME params to execute (runs samples through judges). Poll with " +
        "get_quality_gate_run. genConfig (thinking/maxTokens/temperature) and gateConfig " +
        "(passRateMin) follow the REST contract.",
      inputShape: {
        evaluationId: z.string().min(1).describe("Evaluation id to run."),
        endpointAId: z.string().min(1).describe("Primary endpoint connection id (A)."),
        endpointBId: z.string().optional().describe("Optional comparison endpoint (B)."),
        baselineRunIdOverride: z.string().nullable().optional(),
        gateConfig: z
          .object({
            passRateMin: z.number().min(0).max(1).optional(),
            regressionMax: z.number().int().nonnegative().optional(),
            judgeScoreMin: z.number().min(0).max(5).optional(),
          })
          .describe("Gate thresholds."),
        genConfig: z
          .object({
            maxTokens: z.number().int().min(1).max(32768).optional(),
            temperature: z.number().min(0).max(2).optional(),
            thinking: z.enum(["auto", "on", "off"]).optional(),
            stop: z.array(z.string().min(1).max(64)).max(4).optional(),
          })
          .partial()
          .optional()
          .describe("Per-run generation params (override the eval defaults)."),
        confirmToken: z.string().optional().describe("Omit for dry-run; supply to execute."),
      },
    },
    async (input) => {
      const { confirmToken, ...rest } = input;
      const req = createRunRequestSchema.parse(rest);

      if (!confirmToken) {
        const token = deps.confirmTokens.issue("run_quality_gate", req);
        const plan = {
          dryRun: true,
          willCreate: "quality-gate run (issues model calls + judging)",
          target: { evaluationId: req.evaluationId, endpointAId: req.endpointAId, endpointBId: req.endpointBId },
          request: req,
          confirmToken: token,
          note: "Re-call run_quality_gate with the SAME params plus this confirmToken to execute.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
          structuredContent: plan as unknown as Record<string, unknown>,
        };
      }

      const verdict = deps.confirmTokens.verify("run_quality_gate", req, confirmToken);
      if (!verdict.ok) {
        return {
          content: [
            {
              type: "text",
              text: `confirmToken invalid (${verdict.reason}). Re-run the dry-run for a fresh token; params must match exactly.`,
            },
          ],
          isError: true,
        };
      }
      const created = await deps.runs.create(deps.userId, req);
      return {
        content: [{ type: "text", text: JSON.stringify(created, null, 2) }],
        structuredContent: created as unknown as Record<string, unknown>,
      };
    },
  );
}
```

> Note: the test passes `gateConfig` as a plain object and expects `create` called with `REQ` verbatim. `createRunRequestSchema.parse` applies `genConfigSchema.partial()` etc.; since the test's `REQ` has no `genConfig`, the parsed object equals `REQ` (gateConfig passes through). If `parse` injects defaults that change equality, adjust the test's expected object to the parsed shape — run the test and match its actual `create` arg.

- [ ] **Step 4: Wire (gated registration)**

In `mcp.service.ts`: import `registerRunQualityGate`; inside the `if (deps.allowExecute) { ... }` block add `registerRunQualityGate(server, deps);`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -F @modeldoctor/api test -- run-quality-gate.tool.spec` → PASS
Run: `pnpm -F @modeldoctor/api type-check` → no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/mcp/tools/run-quality-gate.tool.ts apps/api/src/modules/mcp/tools/run-quality-gate.tool.spec.ts apps/api/src/modules/mcp/mcp.service.ts
git commit -m "feat(mcp): run_quality_gate tool (dry-run + confirm, gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: README + e2e + full suite

**Files:**
- Modify: `apps/api/src/modules/mcp/README.md`
- Modify: `apps/api/test/e2e/mcp.e2e-spec.ts`

- [ ] **Step 1: Document the 7 tools in README.md**

Add a new table section "Actuation (V1.1)" after the existing tool tables (follow the existing HTML/markdown table style), with one row per tool:

| Tool | Use case |
|---|---|
| `query_prometheus` | Run read-only PromQL against a connection's datasource |
| `get_engine_metric_catalog` | List an engine's metric keys + PromQL templates |
| `compare_benchmarks` | Align 2–5 benchmarks' metrics side by side |
| `get_benchmark` | Poll a single benchmark to terminal status |
| `get_quality_gate_run` | Poll a single quality-gate run |
| `run_benchmark` | Start a benchmark (dry-run + confirm; gated) |
| `run_quality_gate` | Start a quality-gate run (dry-run + confirm; gated) |

Then add a short prose note documenting the dry-run→confirm handshake and the `MCP_ALLOW_EXECUTE` flag (default true; set false for read-only deployments). Follow the deep-dive section style of `list_prometheus_datasources` for at least `run_benchmark` (input shape → dry-run output → confirm output).

- [ ] **Step 2: Add e2e assertions** (append to `apps/api/test/e2e/mcp.e2e-spec.ts`, reusing its SSE-parsing helper pattern)

```typescript
  it("tools/list includes the new actuation tools", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1, params: {} })
      .buffer(true);
    const raw = (res.text ?? "").toString();
    const m = raw.match(/^data:\s*(\{.*\})\s*$/m);
    const json = JSON.parse(m?.[1] ?? "{}") as { result?: { tools?: Array<{ name: string }> } };
    const names = (json.result?.tools ?? []).map((t) => t.name);
    // read tools always present
    expect(names).toContain("query_prometheus");
    expect(names).toContain("get_engine_metric_catalog");
    expect(names).toContain("compare_benchmarks");
    expect(names).toContain("get_benchmark");
    expect(names).toContain("get_quality_gate_run");
    // execute tools present because .env.test leaves MCP_ALLOW_EXECUTE at its
    // default (true)
    expect(names).toContain("run_benchmark");
    expect(names).toContain("run_quality_gate");
  });

  it("run_benchmark dry-run returns a confirmToken without creating a Job", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "run_benchmark",
          arguments: {
            scenario: "inference",
            tool: "guidellm",
            connectionId: "does-not-need-to-exist-for-dry-run",
            name: "e2e dry-run",
            params: {},
          },
        },
      })
      .buffer(true);
    const raw = (res.text ?? "").toString();
    const m = raw.match(/^data:\s*(\{.*\})\s*$/m);
    const json = JSON.parse(m?.[1] ?? "{}") as {
      result?: { structuredContent?: { dryRun?: boolean; confirmToken?: string } };
    };
    expect(json.result?.structuredContent?.dryRun).toBe(true);
    expect(typeof json.result?.structuredContent?.confirmToken).toBe("string");
  });
```

> The dry-run path never touches `BenchmarkService.create`, so it needs no connection row and no K8s — it only validates the request shape and issues a token. The confirm→create path is covered by the unit tests in Task 8 (with `create` mocked), deliberately keeping live K8s out of e2e.

- [ ] **Step 3: Build once (fresh worktree) then run the full api suite + e2e**

```bash
pnpm -r build
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api test:e2e:api
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api lint
```
Expected: all green. (If lint flags `check:env-example`, it was already validated in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/mcp/README.md apps/api/test/e2e/mcp.e2e-spec.ts
git commit -m "docs(mcp): document actuation tools + e2e for tools/list and dry-run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (before PR)

- [ ] `pnpm -F @modeldoctor/api test` — all unit specs green
- [ ] `pnpm -F @modeldoctor/api test:e2e:api` — mcp e2e green
- [ ] `pnpm -F @modeldoctor/api type-check && pnpm -F @modeldoctor/api lint` — clean
- [ ] Manual sanity (optional): with a real `.env`, `tools/list` over `/api/mcp` shows 23 tools (16 existing + 7 new); flip `MCP_ALLOW_EXECUTE=false` and confirm `run_benchmark`/`run_quality_gate` disappear while the 5 read tools remain.
- [ ] Open single PR `feat/mcp-actuation` (phase-per-commit). Body: link the spec `docs/superpowers/specs/2026-06-01-mcp-actuation-design.md`; note it `refs` any tracking issue (do NOT `closes` an umbrella).
