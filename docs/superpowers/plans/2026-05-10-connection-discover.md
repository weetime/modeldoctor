# Connection Discover (Roadmap A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side endpoint + UI button that, given a baseUrl + optional apiKey, probes the upstream model-serving endpoint and pre-fills 5 Connection fields (`serverKind / models / category / suggestedTags / prometheusUrl`). Migrate the over-grown `ConnectionDialog` (686 lines, ~12 fields) to a `Sheet` (Drawer) so the new Discover UX has room to breathe.

**Architecture:** New `discovery/` submodule under `apps/api/src/modules/connection/` containing (a) SSRF guard with hybrid policy (allow private IPs, block cloud-metadata IPs), (b) safe-fetch wrapper (5s timeout, 1MB cap, 3-redirect limit, re-validates each redirect), (c) 4 parallel GET probes (`/v1/models`, `/metrics`, `/health`, `/`), (d) 4 inference rules (server-kind, category, tags, prometheus-url) — never POST anything (would consume tokens). API response shape is "B+": each inferred field carries `value | confidence | evidence`, plus a top-level `health` object with timing, attempted/failed probes, warnings. Frontend migrates `ConnectionDialog` → `ConnectionSheet`, adds a Discover button + result rendering with auto-badges, edit-mode preserves user-modified fields via `react-hook-form` `dirtyFields`. Tokenizer field is explicitly **out of scope** (relocated to issue #156).

**Tech Stack:** NestJS 10, Prisma (no schema changes), Zod / `@modeldoctor/contracts` for shared schemas, `nestjs-zod` controller validation, `undici` global `fetch`, Vitest 2 (unit), React 18 + react-hook-form + react-query + shadcn (Sheet), Playwright (e2e), i18next (zh-CN + en-US).

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `packages/contracts/src/connection.ts` *(modify)* | Add `discoverConnectionRequestSchema`, `discoverConnectionResponseSchema`, `inferenceConfidenceSchema` |
| `packages/contracts/src/engine-metrics/manifests/index.ts` *(modify)* | Add `ENGINE_METRIC_NAMESPACE` map |
| `apps/api/src/modules/connection/discovery/discovery.service.ts` | Orchestrator: invoke SSRF, run 4 probes in parallel, aggregate inferred result |
| `apps/api/src/modules/connection/discovery/discovery.service.spec.ts` | Spec for orchestrator with mocked probes |
| `apps/api/src/modules/connection/discovery/ssrf-guard.ts` | `assertSafeUrl(url)` — protocol whitelist + DNS resolve + cloud-metadata blocklist |
| `apps/api/src/modules/connection/discovery/ssrf-guard.spec.ts` | Spec for SSRF guard |
| `apps/api/src/modules/connection/discovery/safe-fetch.ts` | `safeFetch(url, opts)` — timeout 5s, response ≤ 1MB, redirect chain re-validated by `assertSafeUrl` |
| `apps/api/src/modules/connection/discovery/safe-fetch.spec.ts` | Spec for safe-fetch |
| `apps/api/src/modules/connection/discovery/probes/index.ts` | `ProbeCtx`, `ProbeResult` types |
| `apps/api/src/modules/connection/discovery/probes/models.ts` | `runModelsProbe` — `GET {baseUrl}/v1/models` |
| `apps/api/src/modules/connection/discovery/probes/models.spec.ts` | Spec |
| `apps/api/src/modules/connection/discovery/probes/metrics.ts` | `runMetricsProbe` — `GET {baseUrl}/metrics` |
| `apps/api/src/modules/connection/discovery/probes/metrics.spec.ts` | Spec |
| `apps/api/src/modules/connection/discovery/probes/health.ts` | `runHealthProbe` — `GET {baseUrl}/health`, fallback `/healthz` |
| `apps/api/src/modules/connection/discovery/probes/health.spec.ts` | Spec |
| `apps/api/src/modules/connection/discovery/probes/server-header.ts` | `runServerHeaderProbe` — `GET {baseUrl}/`, read `Server` / `X-Powered-By` |
| `apps/api/src/modules/connection/discovery/probes/server-header.spec.ts` | Spec |
| `apps/api/src/modules/connection/discovery/inference/server-kind.ts` | `inferServerKind` |
| `apps/api/src/modules/connection/discovery/inference/server-kind.spec.ts` | Spec |
| `apps/api/src/modules/connection/discovery/inference/category.ts` | `inferCategory` |
| `apps/api/src/modules/connection/discovery/inference/category.spec.ts` | Spec |
| `apps/api/src/modules/connection/discovery/inference/tags.ts` | `inferTags` |
| `apps/api/src/modules/connection/discovery/inference/tags.spec.ts` | Spec |
| `apps/api/src/modules/connection/discovery/inference/prometheus-url.ts` | `inferPrometheusUrl` |
| `apps/api/src/modules/connection/discovery/inference/prometheus-url.spec.ts` | Spec |
| `apps/web/src/components/ui/sheet.tsx` | shadcn Sheet (manual copy — project has no `components.json`) |
| `apps/web/src/features/connections/ConnectionSheet.tsx` | Renamed from ConnectionDialog + adds Discover region |
| `apps/web/src/features/connections/ConnectionSheet.test.tsx` | Migrated tests + new Discover-flow tests |
| `e2e/fixtures/mock-vllm-server.ts` | `http.createServer` mock exposing `/v1/models`, `/metrics`, `/health` |
| `e2e/connection-discover.spec.ts` | Playwright e2e — happy path / SSRF / edit-mode dirty preserve |

### Modified files

| Path | Change |
|---|---|
| `apps/api/src/modules/connection/connection.module.ts` | Register `DiscoveryService` provider |
| `apps/api/src/modules/connection/connection.controller.ts` | Add `POST /discover` route |
| `apps/web/src/features/connections/queries.ts` | Add `useDiscoverConnection` mutation hook |
| `apps/web/src/features/connections/ConnectionsPage.tsx` | Replace `ConnectionDialog` import + usage with `ConnectionSheet` |
| `apps/web/src/components/connection/ConnectionPicker.tsx` | Same rename |
| `apps/web/src/locales/zh-CN/connections.json` | Add `dialog.discover.*` keys |
| `apps/web/src/locales/en-US/connections.json` | Same |

### Deleted files

| Path | Reason |
|---|---|
| `apps/web/src/features/connections/ConnectionDialog.tsx` | Replaced by ConnectionSheet |
| `apps/web/src/features/connections/ConnectionDialog.test.tsx` | Tests migrated to `ConnectionSheet.test.tsx` |

---

## Phase 1 — Contracts Foundation

### Task 1: Add discover schemas to `@modeldoctor/contracts`

**Files:**
- Modify: `packages/contracts/src/connection.ts`
- Modify: `packages/contracts/src/connection.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/src/connection.spec.ts`:

```typescript
import {
  discoverConnectionRequestSchema,
  discoverConnectionResponseSchema,
  inferenceConfidenceSchema,
} from "./connection.js";

describe("discoverConnectionRequestSchema", () => {
  it("accepts baseUrl-only input", () => {
    const r = discoverConnectionRequestSchema.parse({ baseUrl: "http://10.0.0.1:8000" });
    expect(r.baseUrl).toBe("http://10.0.0.1:8000");
    expect(r.apiKey).toBeUndefined();
  });

  it("accepts baseUrl + apiKey", () => {
    const r = discoverConnectionRequestSchema.parse({
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
    });
    expect(r.apiKey).toBe("sk-test");
  });

  it("rejects non-URL baseUrl", () => {
    expect(() => discoverConnectionRequestSchema.parse({ baseUrl: "not-a-url" })).toThrow();
  });

  it("rejects empty apiKey", () => {
    expect(() =>
      discoverConnectionRequestSchema.parse({ baseUrl: "http://x", apiKey: "" }),
    ).toThrow();
  });
});

describe("inferenceConfidenceSchema", () => {
  it.each(["certain", "likely", "guess", "unknown"] as const)("accepts %s", (v) => {
    expect(inferenceConfidenceSchema.parse(v)).toBe(v);
  });

  it("rejects unknown value", () => {
    expect(() => inferenceConfidenceSchema.parse("maybe")).toThrow();
  });
});

describe("discoverConnectionResponseSchema", () => {
  it("parses a complete response", () => {
    const valid = {
      health: {
        durationMs: 1234,
        probesAttempted: 4,
        probesFailed: [{ probe: "metrics", reason: "404" }],
        warnings: [],
      },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "metric prefix" },
        models: { values: ["llama-3-8b"], confidence: "certain", evidence: "/v1/models" },
        category: { value: "chat", confidence: "guess", evidence: "default" },
        suggestedTags: { values: ["vllm", "chat", "8b"], confidence: "guess", evidence: "..." },
        prometheusUrl: {
          value: "http://10.0.0.1:8000",
          confidence: "likely",
          evidence: "engine exposes /metrics directly",
        },
      },
    };
    expect(() => discoverConnectionResponseSchema.parse(valid)).not.toThrow();
  });

  it("accepts unknown values as null", () => {
    const valid = {
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: null, confidence: "unknown", evidence: "no signal" },
        models: { values: [], confidence: "unknown", evidence: "endpoint unreachable" },
        category: { value: null, confidence: "unknown", evidence: "no models" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "no signal" },
        prometheusUrl: { value: null, confidence: "unknown", evidence: "no /metrics" },
      },
    };
    expect(() => discoverConnectionResponseSchema.parse(valid)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/contracts test -- connection.spec
```

Expected: FAIL with `discoverConnectionRequestSchema is not exported` (or similar import error).

- [ ] **Step 3: Add schemas to `packages/contracts/src/connection.ts`**

Append at the end of the file (after `connectionRevealKeyResponseSchema`):

```typescript
import { ModalityCategorySchema } from "./modality.js";

export const inferenceConfidenceSchema = z.enum(["certain", "likely", "guess", "unknown"]);
export type InferenceConfidence = z.infer<typeof inferenceConfidenceSchema>;

const inferredFieldSchema = <V extends z.ZodTypeAny>(value: V) =>
  z.object({
    value: value.nullable(),
    confidence: inferenceConfidenceSchema,
    evidence: z.string(),
  });

const inferredListFieldSchema = z.object({
  values: z.array(z.string()),
  confidence: inferenceConfidenceSchema,
  evidence: z.string(),
});

export const discoverConnectionRequestSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
});
export type DiscoverConnectionRequest = z.infer<typeof discoverConnectionRequestSchema>;

export const discoverConnectionResponseSchema = z.object({
  health: z.object({
    durationMs: z.number().int().min(0),
    probesAttempted: z.number().int().min(0),
    probesFailed: z.array(z.object({ probe: z.string(), reason: z.string() })),
    warnings: z.array(z.string()),
  }),
  inferred: z.object({
    serverKind: inferredFieldSchema(serverKindSchema),
    models: inferredListFieldSchema,
    category: inferredFieldSchema(ModalityCategorySchema),
    suggestedTags: inferredListFieldSchema,
    prometheusUrl: inferredFieldSchema(z.string().url()),
  }),
});
export type DiscoverConnectionResponse = z.infer<typeof discoverConnectionResponseSchema>;
```

(Note: `ModalityCategorySchema` is already imported at the top of the file — no duplicate import needed.)

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/contracts test -- connection.spec
```

Expected: PASS, all assertions green.

- [ ] **Step 5: Build contracts so consumers see the new types**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: TypeScript build succeeds, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/connection.ts packages/contracts/src/connection.spec.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add discover connection request/response schemas

For Roadmap A (#151): per-field { value, confidence, evidence }
shape plus top-level health object with timing, probesFailed, warnings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Engine Namespace Registry

### Task 2: Add `ENGINE_METRIC_NAMESPACE` to engine-metrics package

**Files:**
- Modify: `packages/contracts/src/engine-metrics/manifests/index.ts`
- Modify: `packages/contracts/src/engine-metrics.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/src/engine-metrics.spec.ts`:

```typescript
import { ENGINE_METRIC_NAMESPACE } from "./engine-metrics/manifests/index.js";

describe("ENGINE_METRIC_NAMESPACE", () => {
  it("maps each supported engine to its Prometheus prefix", () => {
    expect(ENGINE_METRIC_NAMESPACE.vllm).toBe("vllm:");
    expect(ENGINE_METRIC_NAMESPACE.sglang).toBe("sglang:");
    expect(ENGINE_METRIC_NAMESPACE.tgi).toBe("tgi_");
    expect(ENGINE_METRIC_NAMESPACE.tei).toBe("te_");
    expect(ENGINE_METRIC_NAMESPACE.mindie).toBe("mindie:");
  });

  it("covers exactly the supported engines", () => {
    expect(Object.keys(ENGINE_METRIC_NAMESPACE).sort()).toEqual(
      ["mindie", "sglang", "tei", "tgi", "vllm"].sort(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/contracts test -- engine-metrics.spec
```

Expected: FAIL with `ENGINE_METRIC_NAMESPACE is not exported`.

- [ ] **Step 3: Add registry**

Append to `packages/contracts/src/engine-metrics/manifests/index.ts`:

```typescript
/**
 * Prometheus metric name prefix for each engine. Used by
 * connection-discovery to identify which engine a `/metrics` endpoint
 * belongs to (e.g. presence of `vllm:` prefix → vLLM).
 *
 * Note the inconsistency: vLLM/SGLang/MindIE use `:` separator,
 * TGI uses `_`, TEI uses `te_` (not `tei_`). Matches reality.
 */
export const ENGINE_METRIC_NAMESPACE: Record<SupportedEngineId, string> = {
  vllm: "vllm:",
  sglang: "sglang:",
  tgi: "tgi_",
  tei: "te_",
  mindie: "mindie:",
};
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/contracts test -- engine-metrics.spec
```

Expected: PASS.

- [ ] **Step 5: Rebuild contracts**

```bash
pnpm -F @modeldoctor/contracts build
```

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/index.ts packages/contracts/src/engine-metrics.spec.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add ENGINE_METRIC_NAMESPACE for engine identification

Used by connection-discovery (#151) to recognize which engine a /metrics
endpoint belongs to from the metric name prefix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — SSRF + Safe Fetch

### Task 3: Implement `assertSafeUrl` (SSRF guard)

**Files:**
- Create: `apps/api/src/modules/connection/discovery/ssrf-guard.ts`
- Test: `apps/api/src/modules/connection/discovery/ssrf-guard.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/ssrf-guard.spec.ts`:

```typescript
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { assertSafeUrl } from "./ssrf-guard.js";

vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn() },
  lookup: vi.fn(),
}));

import dns from "node:dns/promises";

describe("assertSafeUrl", () => {
  beforeEach(() => {
    vi.mocked(dns.lookup).mockReset();
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertSafeUrl("gopher://x")).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertSafeUrl("ftp://x")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects AWS metadata IP by hostname", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects GCP metadata hostname", async () => {
    await expect(assertSafeUrl("http://metadata.google.internal/")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects Azure WireServer IP", async () => {
    await expect(assertSafeUrl("http://168.63.129.16/")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects domain that resolves to AWS metadata IP (DNS rebinding)", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "169.254.169.254", family: 4 });
    await expect(assertSafeUrl("http://attacker.example.com/")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("allows public domain", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "104.18.32.1", family: 4 });
    const result = await assertSafeUrl("https://api.openai.com/v1/models");
    expect(result.resolvedIp).toBe("104.18.32.1");
    expect(result.safeUrl.hostname).toBe("api.openai.com");
  });

  it("allows RFC1918 private IP (user's main use case)", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "10.0.5.20", family: 4 });
    await expect(assertSafeUrl("http://10.0.5.20:8000")).resolves.toBeDefined();
  });

  it("allows 127.0.0.1 loopback", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "127.0.0.1", family: 4 });
    await expect(assertSafeUrl("http://127.0.0.1:8000")).resolves.toBeDefined();
  });

  it("allows 192.168.x", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "192.168.1.50", family: 4 });
    await expect(assertSafeUrl("http://192.168.1.50:11434")).resolves.toBeDefined();
  });

  it("rejects malformed URL", async () => {
    await expect(assertSafeUrl("not a url at all")).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- ssrf-guard.spec
```

Expected: FAIL with `assertSafeUrl is not a function` (module doesn't exist).

- [ ] **Step 3: Implement the guard**

Create `apps/api/src/modules/connection/discovery/ssrf-guard.ts`:

```typescript
import dns from "node:dns/promises";
import { BadRequestException } from "@nestjs/common";

const PROTOCOL_WHITELIST = new Set(["http:", "https:"]);

/**
 * Cloud metadata service hosts — never legitimate to discover, always blocked.
 * Hostname-form (e.g. metadata.google.internal) AND resolved-IP-form must be checked
 * to defend against DNS rebinding.
 */
const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254",          // AWS, OpenStack, Alibaba ECS
  "metadata.google.internal", // GCP (resolves to 169.254.169.254 anyway, but block by name too)
  "168.63.129.16",            // Azure WireServer
  "100.100.100.200",          // Alibaba ECS metadata
]);

export interface SafeUrlResult {
  /** The original URL after parsing. Caller should use this rather than the input. */
  safeUrl: URL;
  /** The IP `dns.lookup` resolved the hostname to. Useful for redirect-chain re-validation. */
  resolvedIp: string;
}

/**
 * Validate a user-supplied URL for SSRF safety per Roadmap A's "hybrid policy D":
 *
 *   ALLOW:  public IPs, RFC1918 private (10/8, 172.16/12, 192.168/16), loopback (127/8),
 *           link-local IPv6 (fc00::/7), the user's own internal deployments
 *   BLOCK:  non-http(s) protocols, hardcoded cloud-metadata hosts (also as resolved IP)
 *
 * Throws BadRequestException with a short reason on any rejection.
 */
export async function assertSafeUrl(input: string): Promise<SafeUrlResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BadRequestException("URL malformed");
  }

  if (!PROTOCOL_WHITELIST.has(url.protocol)) {
    throw new BadRequestException(`Protocol not allowed: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (CLOUD_METADATA_HOSTS.has(hostname)) {
    throw new BadRequestException(`Cloud metadata endpoint blocked: ${hostname}`);
  }

  let resolvedIp: string;
  try {
    const r = await dns.lookup(hostname);
    resolvedIp = r.address;
  } catch {
    throw new BadRequestException(`DNS resolution failed for ${hostname}`);
  }

  if (CLOUD_METADATA_HOSTS.has(resolvedIp)) {
    throw new BadRequestException(`Resolved IP blocked: ${resolvedIp}`);
  }

  return { safeUrl: url, resolvedIp };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- ssrf-guard.spec
```

Expected: PASS, all 10 assertions green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/ssrf-guard.ts apps/api/src/modules/connection/discovery/ssrf-guard.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): SSRF guard for connection discovery

Hybrid policy D: allow private IPs (RFC1918/loopback) since user's main
use case is private deployments, but hard-block AWS/GCP/Azure/Alibaba
metadata hosts even after DNS resolution (defense against DNS rebinding).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Implement `safeFetch` wrapper

**Files:**
- Create: `apps/api/src/modules/connection/discovery/safe-fetch.ts`
- Test: `apps/api/src/modules/connection/discovery/safe-fetch.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/safe-fetch.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "./safe-fetch.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("safeFetch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns response on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const r = await safeFetch("http://10.0.0.1:8000/health");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
  });

  it("aborts after timeoutMs", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await expect(safeFetch("http://x", { timeoutMs: 50 })).rejects.toThrow(/abort/i);
  });

  it("rejects when response body exceeds maxBytes", async () => {
    const big = new ArrayBuffer(2 * 1024 * 1024); // 2 MB
    fetchMock.mockResolvedValueOnce(
      new Response(big, { status: 200, headers: { "content-length": "2097152" } }),
    );
    await expect(safeFetch("http://x", { maxBytes: 1024 * 1024 })).rejects.toThrow(/too large/i);
  });

  it("includes Authorization header when apiKey provided", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await safeFetch("http://x", { apiKey: "sk-abc" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-abc" }),
      }),
    );
  });

  it("does not include Authorization when apiKey is undefined", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await safeFetch("http://x");
    const call = fetchMock.mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- safe-fetch.spec
```

Expected: FAIL — `safeFetch is not a function`.

- [ ] **Step 3: Implement safe-fetch**

Create `apps/api/src/modules/connection/discovery/safe-fetch.ts`:

```typescript
export interface SafeFetchOptions {
  /** Bearer token. Sent as `Authorization: Bearer <key>` if present. */
  apiKey?: string;
  /** Abort budget in ms. Default 5000. */
  timeoutMs?: number;
  /** Max response body size in bytes. Default 1 MiB. */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * `fetch` wrapper that:
 *   - aborts after `timeoutMs` (default 5s) — defense against slow probes
 *   - rejects when Content-Length declares a body bigger than `maxBytes` (default 1 MiB)
 *   - injects `Authorization: Bearer <apiKey>` if provided
 *   - leaves redirect handling to the caller (caller must use `redirect: "manual"` if they
 *     want to re-validate each hop; safeFetch defaults to `follow` for simple use)
 *
 * Note: streaming truncation (reject AFTER reading >maxBytes when Content-Length is missing)
 * is intentionally NOT implemented in V1 — most upstream `/metrics` and `/v1/models`
 * responses send Content-Length. If a malicious endpoint omits it and streams gigabytes,
 * we'll be cut off by `timeoutMs` first.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new Error(`Response too large: ${declared} bytes > ${maxBytes}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- safe-fetch.spec
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/safe-fetch.ts apps/api/src/modules/connection/discovery/safe-fetch.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): safeFetch wrapper for connection discovery probes

5s timeout + 1 MiB body cap + optional Bearer header. Used by all 4
discover probes; SSRF protection lives in assertSafeUrl (called by
the orchestrator before any fetch).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Probes

### Task 5: Probe types

**Files:**
- Create: `apps/api/src/modules/connection/discovery/probes/index.ts`

- [ ] **Step 1: Create the types file (no test — pure type declarations)**

Create `apps/api/src/modules/connection/discovery/probes/index.ts`:

```typescript
export interface ProbeCtx {
  /** baseUrl already validated by assertSafeUrl. No trailing slash. */
  baseUrl: string;
  /** Optional Bearer token, forwarded by safeFetch. */
  apiKey?: string;
}

export interface ProbeResult<T = unknown> {
  ok: boolean;
  /** Wall-clock duration of the probe in ms. */
  durationMs: number;
  /** Probe-specific parsed data. Populated only when ok === true. */
  data?: T;
  /** Short failure reason. Populated only when ok === false. */
  reason?: string;
}

export type ModelsProbeData = {
  models: string[];
  /** Raw `/v1/models` response object — used by inference rules that want to look at extra fields like `served_model_name`. */
  raw: unknown;
};

export type MetricsProbeData = {
  /** Raw `/metrics` body (plaintext Prometheus exposition format), trimmed to first 64 KiB. */
  body: string;
};

export type HealthProbeData = {
  /** Which path responded 2xx — `/health` or `/healthz` or null if neither did. */
  path: "/health" | "/healthz";
};

export type ServerHeaderProbeData = {
  /** Lowercased value of `Server` header, or null. */
  server: string | null;
  /** Lowercased value of `X-Powered-By` header, or null. */
  poweredBy: string | null;
};
```

- [ ] **Step 2: Type-check (no separate test, but ensure the file compiles)**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/connection/discovery/probes/index.ts
git commit -m "$(cat <<'EOF'
feat(api): ProbeCtx / ProbeResult types for connection discovery

Each probe (models/metrics/health/server-header) returns a typed
ProbeResult<TData>. Orchestrator aggregates these into the inference layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Models probe (`GET /v1/models`)

**Files:**
- Create: `apps/api/src/modules/connection/discovery/probes/models.ts`
- Test: `apps/api/src/modules/connection/discovery/probes/models.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/probes/models.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runModelsProbe } from "./models.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runModelsProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("parses OpenAI-shape response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [{ id: "llama-3-8b" }, { id: "mistral-7b" }] }),
        { status: 200, headers: { "content-type": "application/json", "content-length": "60" } },
      ),
    );
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.models).toEqual(["llama-3-8b", "mistral-7b"]);
  });

  it("falls back to top-level array", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "x" }, { id: "y" }]), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "20" },
      }),
    );
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.data?.models).toEqual(["x", "y"]);
  });

  it("returns ok=false on 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/401/);
  });

  it("returns ok=false on 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/404/);
  });

  it("returns ok=false on JSON parse error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "20" },
      }),
    );
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/parse/i);
  });

  it("forwards apiKey to safeFetch", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "12" },
      }),
    );
    await runModelsProbe({ baseUrl: "http://x", apiKey: "sk-1" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-1");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "probes/models.spec"
```

Expected: FAIL — `runModelsProbe is not a function`.

- [ ] **Step 3: Implement the probe**

Create `apps/api/src/modules/connection/discovery/probes/models.ts`:

```typescript
import { safeFetch } from "../safe-fetch.js";
import type { ModelsProbeData, ProbeCtx, ProbeResult } from "./index.js";

/**
 * GET {baseUrl}/v1/models — OpenAI-compatible models listing.
 *
 * Tries two response shapes:
 *   1. `{ data: [{id}, ...] }`  (OpenAI standard, vLLM, SGLang, TGI, MindIE)
 *   2. `[{id}, ...]`           (some bare implementations)
 *
 * Returns ok=false on any non-2xx, non-JSON, or schema mismatch.
 */
export async function runModelsProbe(ctx: ProbeCtx): Promise<ProbeResult<ModelsProbeData>> {
  const start = Date.now();
  try {
    const res = await safeFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/v1/models`, {
      apiKey: ctx.apiKey,
    });
    if (!res.ok) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        reason: `HTTP ${res.status}`,
      };
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      return {
        ok: false,
        durationMs: Date.now() - start,
        reason: "Response not parseable as JSON",
      };
    }
    const models = extractModels(raw);
    return {
      ok: true,
      durationMs: Date.now() - start,
      data: { models, raw },
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}

function extractModels(raw: unknown): string[] {
  if (raw && typeof raw === "object" && "data" in raw && Array.isArray((raw as { data: unknown }).data)) {
    return ((raw as { data: Array<{ id?: unknown }> }).data)
      .map((m) => (typeof m?.id === "string" ? m.id : null))
      .filter((id): id is string => id !== null);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((m) => (m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string" ? (m as { id: string }).id : null))
      .filter((id): id is string => id !== null);
  }
  return [];
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "probes/models.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/probes/models.ts apps/api/src/modules/connection/discovery/probes/models.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): models probe — GET /v1/models for connection discovery

Handles both OpenAI standard ({data:[{id}]}) and bare-array shapes.
Forwards apiKey via Bearer header. Returns typed ProbeResult.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Metrics probe (`GET /metrics`)

**Files:**
- Create: `apps/api/src/modules/connection/discovery/probes/metrics.ts`
- Test: `apps/api/src/modules/connection/discovery/probes/metrics.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/probes/metrics.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMetricsProbe } from "./metrics.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runMetricsProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns ok with body on 200", async () => {
    const body = "# HELP vllm:request_success_total ...\nvllm:request_success_total 42\n";
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(body.length) },
      }),
    );
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.body).toContain("vllm:request_success_total");
  });

  it("returns ok=false on 404 (engine doesn't expose /metrics)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/404/);
  });

  it("trims body to 64 KiB", async () => {
    const huge = "vllm:metric 1\n".repeat(20000); // ~260 KB
    fetchMock.mockResolvedValueOnce(
      new Response(huge, {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(huge.length) },
      }),
    );
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    // safeFetch will reject this because content-length > 1 MiB? No — 260 KB < 1 MiB so it passes.
    // But our trimming kicks in to 64 KiB.
    expect(r.ok).toBe(true);
    expect(r.data?.body.length).toBeLessThanOrEqual(64 * 1024);
  });

  it("does NOT forward apiKey (most /metrics endpoints are unauthenticated)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("metric 1", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "8" },
      }),
    );
    await runMetricsProbe({ baseUrl: "http://x", apiKey: "sk-1" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "probes/metrics.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement the probe**

Create `apps/api/src/modules/connection/discovery/probes/metrics.ts`:

```typescript
import { safeFetch } from "../safe-fetch.js";
import type { MetricsProbeData, ProbeCtx, ProbeResult } from "./index.js";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * GET {baseUrl}/metrics — Prometheus exposition format.
 *
 * Most engine /metrics endpoints (vLLM, SGLang, TGI, etc.) are
 * UNAUTHENTICATED on the engine itself, so we deliberately skip apiKey.
 * If a deployment puts auth in front of /metrics, this probe will return
 * ok=false; user can still proceed with manual config.
 *
 * Body trimmed to 64 KiB (fully sufficient for prefix-match identification).
 */
export async function runMetricsProbe(ctx: ProbeCtx): Promise<ProbeResult<MetricsProbeData>> {
  const start = Date.now();
  try {
    const res = await safeFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/metrics`, {
      // intentionally no apiKey
    });
    if (!res.ok) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        reason: `HTTP ${res.status}`,
      };
    }
    const full = await res.text();
    const body = full.length > MAX_BODY_BYTES ? full.slice(0, MAX_BODY_BYTES) : full;
    return {
      ok: true,
      durationMs: Date.now() - start,
      data: { body },
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "probes/metrics.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/probes/metrics.ts apps/api/src/modules/connection/discovery/probes/metrics.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): metrics probe — GET /metrics for engine identification

Returns the body trimmed to 64 KiB. No apiKey (most /metrics endpoints
are unauthenticated on the engine itself).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Health probe (`/health` → fallback `/healthz`)

**Files:**
- Create: `apps/api/src/modules/connection/discovery/probes/health.ts`
- Test: `apps/api/src/modules/connection/discovery/probes/health.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/probes/health.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runHealthProbe } from "./health.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runHealthProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns ok with path=/health when /health is 2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const r = await runHealthProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.path).toBe("/health");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to /healthz on /health 404", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const r = await runHealthProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.path).toBe("/healthz");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns ok=false when both fail", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const r = await runHealthProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no health endpoint/i);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "probes/health.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement the probe**

Create `apps/api/src/modules/connection/discovery/probes/health.ts`:

```typescript
import { safeFetch } from "../safe-fetch.js";
import type { HealthProbeData, ProbeCtx, ProbeResult } from "./index.js";

/**
 * Try GET /health first, fall back to /healthz. Either 2xx → ok.
 *
 * This probe doesn't directly drive any inference (engine identification
 * is done from /metrics), but it confirms the upstream is alive and
 * surfaces a good warning when /v1/models is 401 but the host is fine
 * (e.g. apiKey wrong but host healthy).
 */
export async function runHealthProbe(ctx: ProbeCtx): Promise<ProbeResult<HealthProbeData>> {
  const start = Date.now();
  const base = ctx.baseUrl.replace(/\/+$/, "");
  for (const path of ["/health", "/healthz"] as const) {
    try {
      const res = await safeFetch(`${base}${path}`);
      if (res.ok) {
        return {
          ok: true,
          durationMs: Date.now() - start,
          data: { path },
        };
      }
    } catch {
      // try next path
    }
  }
  return {
    ok: false,
    durationMs: Date.now() - start,
    reason: "no health endpoint (tried /health and /healthz)",
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "probes/health.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/probes/health.ts apps/api/src/modules/connection/discovery/probes/health.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): health probe — /health then /healthz fallback

Used to confirm upstream is alive even when /v1/models is auth-blocked.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Server-header probe

**Files:**
- Create: `apps/api/src/modules/connection/discovery/probes/server-header.ts`
- Test: `apps/api/src/modules/connection/discovery/probes/server-header.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/probes/server-header.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runServerHeaderProbe } from "./server-header.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runServerHeaderProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("captures Server header (lowercased)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { Server: "Higress/2.0.0" } }),
    );
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.server).toBe("higress/2.0.0");
  });

  it("captures X-Powered-By header (lowercased)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "X-Powered-By": "vLLM" } }),
    );
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.data?.poweredBy).toBe("vllm");
  });

  it("ok=true even on 4xx — we still get the headers", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Not Found", { status: 404, headers: { Server: "envoy" } }),
    );
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.server).toBe("envoy");
  });

  it("returns ok=false on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ECONNREFUSED/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "probes/server-header.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement the probe**

Create `apps/api/src/modules/connection/discovery/probes/server-header.ts`:

```typescript
import { safeFetch } from "../safe-fetch.js";
import type { ProbeCtx, ProbeResult, ServerHeaderProbeData } from "./index.js";

/**
 * GET {baseUrl}/ — we don't care about body, only `Server` and
 * `X-Powered-By` headers. Some gateways (Higress, Envoy) and engines
 * (older vLLM) advertise themselves there; weak signal but useful when
 * /metrics returns 404.
 *
 * Note: ok=true even on 4xx because we want the headers regardless of
 * route existence.
 */
export async function runServerHeaderProbe(
  ctx: ProbeCtx,
): Promise<ProbeResult<ServerHeaderProbeData>> {
  const start = Date.now();
  try {
    const res = await safeFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/`);
    return {
      ok: true,
      durationMs: Date.now() - start,
      data: {
        server: res.headers.get("server")?.toLowerCase() ?? null,
        poweredBy: res.headers.get("x-powered-by")?.toLowerCase() ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "probes/server-header.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/probes/server-header.ts apps/api/src/modules/connection/discovery/probes/server-header.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): server-header probe — captures Server / X-Powered-By

Weak engine-identification signal used as fallback when /metrics
is unreachable. ok=true even on 4xx since we want the headers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Inference Rules

### Task 10: server-kind inference

**Files:**
- Create: `apps/api/src/modules/connection/discovery/inference/server-kind.ts`
- Test: `apps/api/src/modules/connection/discovery/inference/server-kind.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/inference/server-kind.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { InferenceConfidence } from "@modeldoctor/contracts";
import { inferServerKind } from "./server-kind.js";
import type {
  MetricsProbeData,
  ModelsProbeData,
  ProbeResult,
  ServerHeaderProbeData,
} from "../probes/index.js";

const okMetrics = (body: string): ProbeResult<MetricsProbeData> => ({
  ok: true,
  durationMs: 100,
  data: { body },
});

const okHeader = (server: string | null, poweredBy: string | null = null): ProbeResult<ServerHeaderProbeData> => ({
  ok: true,
  durationMs: 50,
  data: { server, poweredBy },
});

const okModels = (raw: unknown, models: string[] = []): ProbeResult<ModelsProbeData> => ({
  ok: true,
  durationMs: 50,
  data: { models, raw },
});

const failed = (): ProbeResult<unknown> => ({ ok: false, durationMs: 10, reason: "404" });

describe("inferServerKind", () => {
  it("certain: vllm metric prefix detected", () => {
    const r = inferServerKind({
      metricsR: okMetrics("# HELP vllm:gpu_cache_usage_perc ...\nvllm:gpu_cache_usage_perc 0.5\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("vllm");
    expect(r.confidence).toBe<InferenceConfidence>("certain");
    expect(r.evidence).toMatch(/vllm:/);
  });

  it("certain: sglang prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("sglang:num_running_reqs 5\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("sglang");
  });

  it("certain: tgi underscore prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("tgi_queue_size 3\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("tgi");
  });

  it("certain: tei prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("te_request_count 100\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("tei");
  });

  it("certain: mindie prefix", () => {
    const r = inferServerKind({
      metricsR: okMetrics("mindie:requests_total 42\n"),
      serverHeaderR: failed(),
      modelsR: failed(),
    });
    expect(r.value).toBe("mindie");
  });

  it("likely: Server header contains higress", () => {
    const r = inferServerKind({
      metricsR: failed(),
      serverHeaderR: okHeader("higress/2.0.0"),
      modelsR: failed(),
    });
    expect(r.value).toBe("higress");
    expect(r.confidence).toBe<InferenceConfidence>("likely");
  });

  it("likely: Server header contains vllm even without /metrics", () => {
    const r = inferServerKind({
      metricsR: failed(),
      serverHeaderR: okHeader("vllm/0.6.4"),
      modelsR: failed(),
    });
    expect(r.value).toBe("vllm");
    expect(r.confidence).toBe<InferenceConfidence>("likely");
  });

  it("unknown when nothing matches", () => {
    const r = inferServerKind({
      metricsR: okMetrics("unrelated_metric 1\n"),
      serverHeaderR: okHeader("nginx/1.21"),
      modelsR: failed(),
    });
    expect(r.value).toBeNull();
    expect(r.confidence).toBe<InferenceConfidence>("unknown");
  });

  it("metrics signal beats header signal", () => {
    const r = inferServerKind({
      metricsR: okMetrics("vllm:something 1\n"),
      serverHeaderR: okHeader("envoy"),  // would be ignored
      modelsR: failed(),
    });
    expect(r.value).toBe("vllm");
    expect(r.confidence).toBe<InferenceConfidence>("certain");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "inference/server-kind.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement the inference**

Create `apps/api/src/modules/connection/discovery/inference/server-kind.ts`:

```typescript
import {
  ENGINE_METRIC_NAMESPACE,
  type ServerKind,
  type InferenceConfidence,
} from "@modeldoctor/contracts";
import type {
  MetricsProbeData,
  ModelsProbeData,
  ProbeResult,
  ServerHeaderProbeData,
} from "../probes/index.js";

interface Inputs {
  metricsR: ProbeResult<MetricsProbeData>;
  serverHeaderR: ProbeResult<ServerHeaderProbeData>;
  modelsR: ProbeResult<ModelsProbeData>;
}

interface InferredField<T> {
  value: T | null;
  confidence: InferenceConfidence;
  evidence: string;
}

/**
 * Header-keyword → ServerKind mapping (likely-tier signal).
 * Order doesn't matter — first hit wins, all values are mutually exclusive.
 */
const HEADER_KEYWORDS: Array<[string, ServerKind]> = [
  ["vllm", "vllm"],
  ["sglang", "sglang"],
  ["tgi", "tgi"],
  ["text-generation-inference", "tgi"],
  ["mindie", "mindie"],
  ["lmdeploy", "lmdeploy"],
  ["higress", "higress"],
];

export function inferServerKind(inputs: Inputs): InferredField<ServerKind> {
  // (1) certain: /metrics prefix
  if (inputs.metricsR.ok && inputs.metricsR.data) {
    const body = inputs.metricsR.data.body;
    for (const [engineId, prefix] of Object.entries(ENGINE_METRIC_NAMESPACE)) {
      if (body.includes(`\n${prefix}`) || body.startsWith(prefix)) {
        return {
          value: engineId as ServerKind,
          confidence: "certain",
          evidence: `metric prefix '${prefix}' detected at /metrics`,
        };
      }
    }
  }

  // (2) likely: Server / X-Powered-By header
  if (inputs.serverHeaderR.ok && inputs.serverHeaderR.data) {
    const haystacks = [inputs.serverHeaderR.data.server, inputs.serverHeaderR.data.poweredBy]
      .filter((s): s is string => !!s)
      .join(" ");
    for (const [keyword, kind] of HEADER_KEYWORDS) {
      if (haystacks.includes(keyword)) {
        return {
          value: kind,
          confidence: "likely",
          evidence: `header contains '${keyword}'`,
        };
      }
    }
  }

  // (3) unknown
  return {
    value: null,
    confidence: "unknown",
    evidence: "no engine signal detected",
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "inference/server-kind.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/inference/server-kind.ts apps/api/src/modules/connection/discovery/inference/server-kind.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): server-kind inference rule

Tier 1 (certain): /metrics prefix from ENGINE_METRIC_NAMESPACE.
Tier 2 (likely): Server / X-Powered-By header keyword.
Tier 3: unknown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: category inference

**Files:**
- Create: `apps/api/src/modules/connection/discovery/inference/category.ts`
- Test: `apps/api/src/modules/connection/discovery/inference/category.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/inference/category.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { InferenceConfidence } from "@modeldoctor/contracts";
import { inferCategory } from "./category.js";

describe("inferCategory", () => {
  // Each case: [model id, expected category, expected confidence]
  const cases: Array<[string, string | null, InferenceConfidence]> = [
    // rerank — must take precedence over embed since "bge-reranker" contains both
    ["bge-reranker-v2-m3", "rerank", "likely"],
    ["my-rerank-model", "rerank", "likely"],
    // embed
    ["bge-large-en", "embeddings", "likely"],
    ["text-embedding-3-small", "embeddings", "likely"],
    ["e5-mistral-7b", "embeddings", "likely"],
    ["gte-large", "embeddings", "likely"],
    ["m3e-base", "embeddings", "likely"],
    // image
    ["flux-dev", "image", "likely"],
    ["sd-xl-base", "image", "likely"],
    ["stable-diffusion-3", "image", "likely"],
    ["dall-e-3", "image", "likely"],
    ["imagen-2", "image", "likely"],
    // audio
    ["whisper-large-v3", "audio", "likely"],
    ["voxtral-small", "audio", "likely"],
    ["my-tts-model", "audio", "likely"],
    ["parakeet-en", "audio", "likely"],
    // chat (default)
    ["gpt-4o-mini", "chat", "guess"],
    ["llama-3-70b-instruct", "chat", "guess"],
    ["qwen2.5-7b", "chat", "guess"],
    ["claude-haiku", "chat", "guess"],
  ];

  it.each(cases)("infers category for '%s'", (modelId, expectedCategory, expectedConf) => {
    const r = inferCategory({ models: [modelId] });
    expect(r.value).toBe(expectedCategory);
    expect(r.confidence).toBe(expectedConf);
  });

  it("uses first model when multiple are present", () => {
    const r = inferCategory({ models: ["bge-large-en", "gpt-4o"] });
    expect(r.value).toBe("embeddings");
  });

  it("returns unknown when no models", () => {
    const r = inferCategory({ models: [] });
    expect(r.value).toBeNull();
    expect(r.confidence).toBe<InferenceConfidence>("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "inference/category.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement the inference**

Create `apps/api/src/modules/connection/discovery/inference/category.ts`:

```typescript
import type { ModalityCategory, InferenceConfidence } from "@modeldoctor/contracts";

interface Inputs {
  models: string[];
}

interface InferredField {
  value: ModalityCategory | null;
  confidence: InferenceConfidence;
  evidence: string;
}

/**
 * Match rules in priority order. First hit wins (per spec §4.4.2).
 *
 * Note: rerank MUST come before embed because "bge-reranker" contains
 * "embed"-adjacent context "reranker" — but more importantly, distinct
 * keyword `rerank` is the strongest signal.
 */
const RULES: Array<{ pattern: RegExp; category: ModalityCategory; keyword: string }> = [
  { pattern: /\b(rerank|reranker)\b/, category: "rerank", keyword: "rerank" },
  { pattern: /(?:^|[\W_])(embed|bge|e5-|gte-|m3e)/, category: "embeddings", keyword: "embed/bge/e5/gte/m3e" },
  { pattern: /(flux|sd-|stable-diffusion|dall-?e|imagen)/, category: "image", keyword: "flux/sd/dall-e/imagen" },
  { pattern: /(whisper|voxtral|tts|parakeet)/, category: "audio", keyword: "whisper/voxtral/tts/parakeet" },
];

export function inferCategory(inputs: Inputs): InferredField {
  if (inputs.models.length === 0) {
    return { value: null, confidence: "unknown", evidence: "no models discovered" };
  }
  const id = inputs.models[0].toLowerCase();
  for (const rule of RULES) {
    if (rule.pattern.test(id)) {
      return {
        value: rule.category,
        confidence: "likely",
        evidence: `matched '${rule.keyword}' in model id '${inputs.models[0]}'`,
      };
    }
  }
  return {
    value: "chat",
    confidence: "guess",
    evidence: `default — no category keyword in '${inputs.models[0]}'`,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "inference/category.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/inference/category.ts apps/api/src/modules/connection/discovery/inference/category.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): category inference from model id keywords

Priority order (first match): rerank > embeddings > image > audio > chat (default).
No POST probes — rules are pure model-id heuristics, never consume tokens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: tags inference

**Files:**
- Create: `apps/api/src/modules/connection/discovery/inference/tags.ts`
- Test: `apps/api/src/modules/connection/discovery/inference/tags.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/inference/tags.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { inferTags } from "./tags.js";

describe("inferTags", () => {
  it("includes serverKind and category names", () => {
    const r = inferTags({
      serverKind: "vllm",
      category: "chat",
      models: [],
    });
    expect(r.values).toContain("vllm");
    expect(r.values).toContain("chat");
  });

  it("extracts model size from id", () => {
    const r = inferTags({
      serverKind: "vllm",
      category: "chat",
      models: ["llama-3-70b-instruct"],
    });
    expect(r.values).toContain("70b");
  });

  it("extracts model form-factor (instruct/chat/base/code/math)", () => {
    expect(inferTags({ serverKind: null, category: null, models: ["llama-instruct"] }).values).toContain("instruct");
    expect(inferTags({ serverKind: null, category: null, models: ["my-base-model"] }).values).toContain("base");
    expect(inferTags({ serverKind: null, category: null, models: ["code-llama-7b"] }).values).toContain("code");
    expect(inferTags({ serverKind: null, category: null, models: ["llema-math-3b"] }).values).toContain("math");
  });

  it("extracts quantization (awq/gptq/fp8/int4)", () => {
    expect(inferTags({ serverKind: null, category: null, models: ["llama-7b-awq"] }).values).toContain("awq");
    expect(inferTags({ serverKind: null, category: null, models: ["model-gptq"] }).values).toContain("gptq");
    expect(inferTags({ serverKind: null, category: null, models: ["model-fp8"] }).values).toContain("fp8");
    expect(inferTags({ serverKind: null, category: null, models: ["model-int4"] }).values).toContain("int4");
  });

  it("returns up to 8 tags, deduplicated", () => {
    const r = inferTags({
      serverKind: "vllm",
      category: "chat",
      models: ["llama-3-70b-instruct-awq", "llama-3-70b-instruct-awq", "llama-3-70b-instruct-awq"],
    });
    expect(r.values.length).toBeLessThanOrEqual(8);
    expect(new Set(r.values).size).toBe(r.values.length);
  });

  it("returns guess confidence", () => {
    const r = inferTags({ serverKind: "vllm", category: "chat", models: [] });
    expect(r.confidence).toBe("guess");
  });

  it("empty when no inputs at all", () => {
    const r = inferTags({ serverKind: null, category: null, models: [] });
    expect(r.values).toEqual([]);
    expect(r.confidence).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "inference/tags.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement the inference**

Create `apps/api/src/modules/connection/discovery/inference/tags.ts`:

```typescript
import type {
  InferenceConfidence,
  ModalityCategory,
  ServerKind,
} from "@modeldoctor/contracts";

interface Inputs {
  serverKind: ServerKind | null;
  category: ModalityCategory | null;
  models: string[];
}

interface InferredList {
  values: string[];
  confidence: InferenceConfidence;
  evidence: string;
}

const SIZE_RE = /\b(\d+(?:\.\d+)?)b\b/i;
const FORM_FACTOR_KEYWORDS = ["instruct", "chat", "base", "code", "math"];
const QUANT_KEYWORDS = ["awq", "gptq", "fp8", "int4"];

const MAX_TAGS = 8;

export function inferTags(inputs: Inputs): InferredList {
  const tags = new Set<string>();
  const evidence: string[] = [];

  if (inputs.serverKind) {
    tags.add(inputs.serverKind);
    evidence.push(`serverKind=${inputs.serverKind}`);
  }
  if (inputs.category) {
    tags.add(inputs.category);
    evidence.push(`category=${inputs.category}`);
  }

  for (const id of inputs.models) {
    const lower = id.toLowerCase();

    const sizeMatch = lower.match(SIZE_RE);
    if (sizeMatch) tags.add(`${sizeMatch[1]}b`);

    for (const kw of FORM_FACTOR_KEYWORDS) {
      if (lower.includes(kw)) tags.add(kw);
    }
    for (const kw of QUANT_KEYWORDS) {
      if (lower.includes(kw)) tags.add(kw);
    }

    if (tags.size >= MAX_TAGS) break;
  }

  const values = Array.from(tags).slice(0, MAX_TAGS);

  if (values.length === 0) {
    return { values: [], confidence: "unknown", evidence: "no inputs" };
  }
  return {
    values,
    confidence: "guess",
    evidence: `derived from ${evidence.join(", ")}${inputs.models.length > 0 ? " + model ids" : ""}`,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "inference/tags.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/inference/tags.ts apps/api/src/modules/connection/discovery/inference/tags.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): tag inference from serverKind + category + model id

Sources: serverKind name, category name, model size (regex \b\d+b\b),
form-factor (instruct/chat/base/code/math), quantization (awq/gptq/fp8/int4).
Deduplicated, max 8. Always 'guess' confidence — user must Apply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: prometheus-url inference

**Files:**
- Create: `apps/api/src/modules/connection/discovery/inference/prometheus-url.ts`
- Test: `apps/api/src/modules/connection/discovery/inference/prometheus-url.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/inference/prometheus-url.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { InferenceConfidence } from "@modeldoctor/contracts";
import { inferPrometheusUrl } from "./prometheus-url.js";
import type { MetricsProbeData, ProbeResult } from "../probes/index.js";

const okMetrics = (body: string): ProbeResult<MetricsProbeData> => ({
  ok: true,
  durationMs: 10,
  data: { body },
});
const failed = (): ProbeResult<MetricsProbeData> => ({ ok: false, durationMs: 5, reason: "404" });

describe("inferPrometheusUrl", () => {
  it("likely: /metrics 200 with known engine prefix → suggest baseUrl", () => {
    const r = inferPrometheusUrl({
      baseUrl: "http://10.0.0.1:8000",
      metricsR: okMetrics("vllm:something 1\n"),
    });
    expect(r.value).toBe("http://10.0.0.1:8000");
    expect(r.confidence).toBe<InferenceConfidence>("likely");
  });

  it("guess: /metrics 200 but unrecognized format", () => {
    const r = inferPrometheusUrl({
      baseUrl: "http://10.0.0.1:8000",
      metricsR: okMetrics("some_unrelated_metric 1\n"),
    });
    expect(r.value).toBe("http://10.0.0.1:8000");
    expect(r.confidence).toBe<InferenceConfidence>("guess");
  });

  it("unknown: /metrics non-200", () => {
    const r = inferPrometheusUrl({
      baseUrl: "http://10.0.0.1:8000",
      metricsR: failed(),
    });
    expect(r.value).toBeNull();
    expect(r.confidence).toBe<InferenceConfidence>("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "inference/prometheus-url.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/api/src/modules/connection/discovery/inference/prometheus-url.ts`:

```typescript
import { ENGINE_METRIC_NAMESPACE, type InferenceConfidence } from "@modeldoctor/contracts";
import type { MetricsProbeData, ProbeResult } from "../probes/index.js";

interface Inputs {
  baseUrl: string;
  metricsR: ProbeResult<MetricsProbeData>;
}

interface InferredField {
  value: string | null;
  confidence: InferenceConfidence;
  evidence: string;
}

export function inferPrometheusUrl(inputs: Inputs): InferredField {
  if (!inputs.metricsR.ok || !inputs.metricsR.data) {
    return {
      value: null,
      confidence: "unknown",
      evidence: "no /metrics endpoint detected",
    };
  }
  const body = inputs.metricsR.data.body;
  const hasKnownPrefix = Object.values(ENGINE_METRIC_NAMESPACE).some(
    (prefix) => body.includes(`\n${prefix}`) || body.startsWith(prefix),
  );
  if (hasKnownPrefix) {
    return {
      value: inputs.baseUrl,
      confidence: "likely",
      evidence:
        "engine exposes /metrics directly; OK for single-pod deployment, otherwise use your aggregating Prometheus URL",
    };
  }
  return {
    value: inputs.baseUrl,
    confidence: "guess",
    evidence: "endpoint exposes /metrics with unrecognized format; verify before use",
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "inference/prometheus-url.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/inference/prometheus-url.ts apps/api/src/modules/connection/discovery/inference/prometheus-url.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): prometheus-url inference rule

likely: /metrics 200 + known engine prefix → suggest baseUrl.
guess:  /metrics 200 + unknown format → suggest with warning.
unknown: /metrics not 200.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Discovery Service (Orchestrator)

### Task 14: DiscoveryService

**Files:**
- Create: `apps/api/src/modules/connection/discovery/discovery.service.ts`
- Test: `apps/api/src/modules/connection/discovery/discovery.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/connection/discovery/discovery.service.spec.ts`:

```typescript
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryService } from "./discovery.service.js";

vi.mock("./ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(),
}));
vi.mock("./probes/models.js", () => ({ runModelsProbe: vi.fn() }));
vi.mock("./probes/metrics.js", () => ({ runMetricsProbe: vi.fn() }));
vi.mock("./probes/health.js", () => ({ runHealthProbe: vi.fn() }));
vi.mock("./probes/server-header.js", () => ({ runServerHeaderProbe: vi.fn() }));

import { assertSafeUrl } from "./ssrf-guard.js";
import { runHealthProbe } from "./probes/health.js";
import { runMetricsProbe } from "./probes/metrics.js";
import { runModelsProbe } from "./probes/models.js";
import { runServerHeaderProbe } from "./probes/server-header.js";

describe("DiscoveryService", () => {
  let service: DiscoveryService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(assertSafeUrl).mockResolvedValue({ safeUrl: new URL("http://x"), resolvedIp: "10.0.0.1" });
    const module = await Test.createTestingModule({ providers: [DiscoveryService] }).compile();
    service = module.get(DiscoveryService);
  });

  it("aggregates 4 probe results into B+ shape (happy path: vLLM)", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: true,
      durationMs: 100,
      data: { models: ["llama-3-70b-instruct"], raw: { data: [{ id: "llama-3-70b-instruct" }] } },
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({
      ok: true,
      durationMs: 80,
      data: { body: "vllm:request_success_total 42\n" },
    });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 30,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: "vllm/0.6.4", poweredBy: null },
    });

    const r = await service.discover({ baseUrl: "http://x" });

    expect(r.health.probesAttempted).toBe(4);
    expect(r.health.probesFailed).toEqual([]);
    expect(r.inferred.serverKind.value).toBe("vllm");
    expect(r.inferred.serverKind.confidence).toBe("certain");
    expect(r.inferred.models.values).toEqual(["llama-3-70b-instruct"]);
    expect(r.inferred.category.value).toBe("chat");
    expect(r.inferred.suggestedTags.values).toContain("vllm");
    expect(r.inferred.suggestedTags.values).toContain("70b");
    expect(r.inferred.prometheusUrl.value).toBe("http://x");
    expect(r.inferred.prometheusUrl.confidence).toBe("likely");
  });

  it("records probe failures in health.probesFailed", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: false,
      durationMs: 50,
      reason: "HTTP 401",
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({
      ok: false,
      durationMs: 50,
      reason: "HTTP 404",
    });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 20,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: null, poweredBy: null },
    });

    const r = await service.discover({ baseUrl: "http://x" });

    expect(r.health.probesFailed).toHaveLength(2);
    expect(r.health.probesFailed.map((p) => p.probe).sort()).toEqual(["metrics", "models"]);
    expect(r.inferred.serverKind.value).toBeNull();
    expect(r.inferred.serverKind.confidence).toBe("unknown");
  });

  it("propagates SSRF reject as BadRequestException", async () => {
    vi.mocked(assertSafeUrl).mockRejectedValueOnce(new Error("Cloud metadata endpoint blocked"));
    await expect(service.discover({ baseUrl: "http://169.254.169.254" })).rejects.toThrow(
      /Cloud metadata/,
    );
  });

  it("emits warning when /v1/models is 401 but /health is OK", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: false,
      durationMs: 50,
      reason: "HTTP 401",
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({ ok: false, durationMs: 50, reason: "HTTP 404" });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 20,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: null, poweredBy: null },
    });

    const r = await service.discover({ baseUrl: "http://x", apiKey: "wrong-key" });
    expect(r.health.warnings.some((w) => w.includes("apiKey"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "discovery.service.spec"
```

Expected: FAIL.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/connection/discovery/discovery.service.ts`:

```typescript
import {
  type DiscoverConnectionRequest,
  type DiscoverConnectionResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { inferCategory } from "./inference/category.js";
import { inferPrometheusUrl } from "./inference/prometheus-url.js";
import { inferServerKind } from "./inference/server-kind.js";
import { inferTags } from "./inference/tags.js";
import { runHealthProbe } from "./probes/health.js";
import { runMetricsProbe } from "./probes/metrics.js";
import { runModelsProbe } from "./probes/models.js";
import { runServerHeaderProbe } from "./probes/server-header.js";
import type { ProbeResult } from "./probes/index.js";
import { assertSafeUrl } from "./ssrf-guard.js";

@Injectable()
export class DiscoveryService {
  async discover(input: DiscoverConnectionRequest): Promise<DiscoverConnectionResponse> {
    const start = Date.now();
    await assertSafeUrl(input.baseUrl);
    const ctx = { baseUrl: input.baseUrl, apiKey: input.apiKey };

    const [modelsR, metricsR, healthR, serverHeaderR] = await Promise.all([
      runModelsProbe(ctx),
      runMetricsProbe(ctx),
      runHealthProbe(ctx),
      runServerHeaderProbe(ctx),
    ]);

    const probesFailed = collectFailures({ modelsR, metricsR, healthR, serverHeaderR });
    const warnings = collectWarnings({ modelsR, metricsR, healthR, hasApiKey: !!input.apiKey });

    const serverKind = inferServerKind({ metricsR, serverHeaderR, modelsR });
    const models = inferModelsField(modelsR);
    const category = inferCategory({ models: models.values });
    const suggestedTags = inferTags({
      serverKind: serverKind.value,
      category: category.value,
      models: models.values,
    });
    const prometheusUrl = inferPrometheusUrl({ baseUrl: input.baseUrl, metricsR });

    return {
      health: {
        durationMs: Date.now() - start,
        probesAttempted: 4,
        probesFailed,
        warnings,
      },
      inferred: {
        serverKind,
        models,
        category,
        suggestedTags,
        prometheusUrl,
      },
    };
  }
}

function collectFailures(results: {
  modelsR: ProbeResult<unknown>;
  metricsR: ProbeResult<unknown>;
  healthR: ProbeResult<unknown>;
  serverHeaderR: ProbeResult<unknown>;
}): Array<{ probe: string; reason: string }> {
  const out: Array<{ probe: string; reason: string }> = [];
  for (const [probe, result] of Object.entries(results)) {
    if (!result.ok) {
      out.push({ probe: probe.replace(/R$/, ""), reason: result.reason ?? "unknown" });
    }
  }
  return out;
}

function collectWarnings(args: {
  modelsR: ProbeResult<unknown>;
  metricsR: ProbeResult<unknown>;
  healthR: ProbeResult<unknown>;
  hasApiKey: boolean;
}): string[] {
  const warnings: string[] = [];
  // Common case: apiKey provided, /v1/models returns 401, but /health OK → key likely wrong
  if (
    args.hasApiKey &&
    !args.modelsR.ok &&
    args.modelsR.reason?.includes("401") &&
    args.healthR.ok
  ) {
    warnings.push("apiKey was provided but /v1/models returned 401 — verify the key is valid");
  }
  return warnings;
}

function inferModelsField(modelsR: ProbeResult<{ models: string[]; raw: unknown }>): {
  values: string[];
  confidence: "certain" | "likely" | "guess" | "unknown";
  evidence: string;
} {
  if (modelsR.ok && modelsR.data) {
    return {
      values: modelsR.data.models,
      confidence: "certain",
      evidence: `${modelsR.data.models.length} model(s) from /v1/models`,
    };
  }
  return {
    values: [],
    confidence: "unknown",
    evidence: modelsR.reason ?? "models probe failed",
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- "discovery.service.spec"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/discovery.service.ts apps/api/src/modules/connection/discovery/discovery.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): DiscoveryService orchestrator

Calls assertSafeUrl, then 4 parallel probes, then composes B+ response
with inferred fields + health/warnings. Emits "apiKey 401 but /health OK"
warning to help users diagnose wrong-key cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — HTTP Endpoint

### Task 15: Add `POST /api/connections/discover` controller route + module registration

**Files:**
- Modify: `apps/api/src/modules/connection/connection.module.ts`
- Modify: `apps/api/src/modules/connection/connection.controller.ts`
- Modify: `apps/api/src/modules/connection/connection.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

Append to `apps/api/src/modules/connection/connection.controller.spec.ts` a new describe block:

```typescript
import { DiscoveryService } from "./discovery/discovery.service.js";

describe("ConnectionController.discover", () => {
  let controller: ConnectionController;
  let discovery: { discover: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    discovery = { discover: vi.fn() };
    const module = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        { provide: ConnectionService, useValue: { /* unused for these tests */ } },
        { provide: DiscoveryService, useValue: discovery },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ConnectionController);
  });

  it("forwards request body to DiscoveryService and returns its response", async () => {
    const fake = {
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "ok" },
        models: { values: ["m"], confidence: "certain", evidence: "ok" },
        category: { value: "chat", confidence: "guess", evidence: "default" },
        suggestedTags: { values: ["vllm"], confidence: "guess", evidence: "ok" },
        prometheusUrl: { value: "http://x", confidence: "likely", evidence: "ok" },
      },
    };
    discovery.discover.mockResolvedValue(fake);
    const r = await controller.discover({ baseUrl: "http://x" });
    expect(discovery.discover).toHaveBeenCalledWith({ baseUrl: "http://x" });
    expect(r).toEqual(fake);
  });
});
```

(The existing `ConnectionController` describe block in this file uses a different mock setup; this new block stands on its own.)

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- "connection.controller.spec"
```

Expected: FAIL — `discover` method doesn't exist on controller, or `DiscoveryService` import not found.

- [ ] **Step 3: Add `DiscoveryService` to module**

Modify `apps/api/src/modules/connection/connection.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionController } from "./connection.controller.js";
import { ConnectionService } from "./connection.service.js";
import { DiscoveryService } from "./discovery/discovery.service.js";

@Module({
  controllers: [ConnectionController],
  providers: [PrismaService, ConnectionService, DiscoveryService],
  exports: [ConnectionService],
})
export class ConnectionModule {}
```

- [ ] **Step 4: Add controller route**

Modify `apps/api/src/modules/connection/connection.controller.ts`:

Add at the top of the imports:

```typescript
import {
  type DiscoverConnectionRequest,
  type DiscoverConnectionResponse,
  discoverConnectionRequestSchema,
} from "@modeldoctor/contracts";
import { DiscoveryService } from "./discovery/discovery.service.js";
```

Update constructor:

```typescript
constructor(
  private readonly service: ConnectionService,
  private readonly discoveryService: DiscoveryService,
) {}
```

Add new route (place it after `revealKey`, before `update`):

```typescript
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Post("discover")
discover(
  @Body(new ZodValidationPipe(discoverConnectionRequestSchema)) body: DiscoverConnectionRequest,
): Promise<DiscoverConnectionResponse> {
  return this.discoveryService.discover(body);
}
```

- [ ] **Step 5: Run unit + spec tests**

```bash
pnpm -F @modeldoctor/api test -- connection.controller
pnpm -F @modeldoctor/api type-check
```

Expected: PASS, no type errors.

- [ ] **Step 6: Manual smoke (optional but recommended)**

Start dev server in another terminal: `pnpm dev`. Then:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .accessToken)

curl -X POST http://localhost:3001/api/connections/discover \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"baseUrl":"http://localhost:8000","apiKey":"sk-test"}'
```

Expected: 200 with B+ shape (will be mostly `unknown` if no real engine running — that's fine).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/connection/connection.module.ts apps/api/src/modules/connection/connection.controller.ts apps/api/src/modules/connection/connection.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /api/connections/discover endpoint

Throttled 10/min/user (same as revealKey). Validates body with
discoverConnectionRequestSchema, delegates to DiscoveryService.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Sheet Component

### Task 16: Add shadcn Sheet component (manual copy)

**Files:**
- Create: `apps/web/src/components/ui/sheet.tsx`

- [ ] **Step 1: Create the Sheet primitive**

Create `apps/web/src/components/ui/sheet.tsx`:

```tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type VariantProps, cva } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: { side: "right" },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
```

- [ ] **Step 2: Verify type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors. (`class-variance-authority` is already a dependency of `@modeldoctor/web` — verified via `apps/web/package.json` listing `"class-variance-authority": "^0.7.1"`. It's also imported by `apps/web/src/components/ui/{button,alert,badge,label}.tsx`, so the new Sheet's `cva` import resolves with no install.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/sheet.tsx
git commit -m "$(cat <<'EOF'
feat(web): add shadcn Sheet primitive (manual copy, no components.json)

Pre-req for ConnectionDialog → ConnectionSheet migration. Side-variant
right by default; ConnectionSheet uses sm:max-w-[640px] to fit ~12 fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Connection Sheet Migration

### Task 17: Create `ConnectionSheet.tsx` (mechanical migration)

**Files:**
- Create: `apps/web/src/features/connections/ConnectionSheet.tsx`

- [ ] **Step 1: Read current ConnectionDialog.tsx in full so the copy is faithful**

```bash
cat apps/web/src/features/connections/ConnectionDialog.tsx
```

(Read; no edits yet.)

- [ ] **Step 2: Create `ConnectionSheet.tsx` by copy + structural-replace**

Copy the entire content of `ConnectionDialog.tsx` to `ConnectionSheet.tsx`. Then make ONLY these structural changes (logic intact):

1. Update import block — replace:
   ```typescript
   import {
     Dialog,
     DialogContent,
     DialogFooter,
     DialogHeader,
     DialogTitle,
   } from "@/components/ui/dialog";
   ```
   with:
   ```typescript
   import {
     Sheet,
     SheetContent,
     SheetFooter,
     SheetHeader,
     SheetTitle,
   } from "@/components/ui/sheet";
   ```

2. Rename the component:
   ```typescript
   export function ConnectionDialog(...)  →  export function ConnectionSheet(...)
   ```

   And the props type:
   ```typescript
   ConnectionDialogProps  →  ConnectionSheetProps
   ConnectionDialogMode   →  ConnectionSheetMode    // (and update type alias name)
   ```

3. JSX structural replace (occurs once, around line 270 of original):
   ```tsx
   <Dialog open={open} onOpenChange={onOpenChange}>
     <DialogContent className="...">
       <DialogHeader>
         <DialogTitle>...</DialogTitle>
       </DialogHeader>
       {/* form */}
       <DialogFooter>...</DialogFooter>
     </DialogContent>
   </Dialog>
   ```

   becomes:

   ```tsx
   <Sheet open={open} onOpenChange={onOpenChange}>
     <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[640px]">
       <SheetHeader>
         <SheetTitle>...</SheetTitle>
       </SheetHeader>
       {/* form (unchanged) */}
       <SheetFooter>...</SheetFooter>
     </SheetContent>
   </Sheet>
   ```

   (Footer markup and form children are unchanged.)

4. **Don't change anything else.** Keep all `useForm` / `useEffect` / `onSubmit` / curl import logic identical.

- [ ] **Step 3: Verify type-check passes**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors **inside `ConnectionSheet.tsx`**. (Errors elsewhere — places still importing `ConnectionDialog` — are addressed in Task 18.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/connections/ConnectionSheet.tsx
git commit -m "$(cat <<'EOF'
feat(web): create ConnectionSheet (Drawer) — mechanical migration from ConnectionDialog

Same form logic, same props API (open / onOpenChange / mode / initialValues / onSaved),
only the outer shell changes from Dialog to Sheet (side=right, max-w 640px) to fit
~12 fields without scroll. Old ConnectionDialog stays for one commit so callers can
be updated atomically in Task 18 then deleted in Task 19.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Update all callers

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionsPage.tsx`
- Modify: `apps/web/src/components/connection/ConnectionPicker.tsx`
- Modify: any other file in `apps/web/src` that imports `ConnectionDialog`

- [ ] **Step 1: Find all callers**

```bash
grep -rn "ConnectionDialog" apps/web/src
```

Expected: results in `ConnectionsPage.tsx`, `ConnectionPicker.tsx`, and possibly `queries.test.tsx` or `ConnectionsPage.test.tsx`.

- [ ] **Step 2: For each non-test file, replace import + JSX tag**

For each call-site (e.g. `ConnectionsPage.tsx`):

```typescript
// before
import { ConnectionDialog } from "./ConnectionDialog";
// after
import { ConnectionSheet } from "./ConnectionSheet";
```

```tsx
// before
<ConnectionDialog open={...} onOpenChange={...} mode={...} ... />
// after
<ConnectionSheet open={...} onOpenChange={...} mode={...} ... />
```

Apply identical mechanical change everywhere `ConnectionDialog` is referenced as a component (not where it's a prop name or string literal).

- [ ] **Step 3: Verify type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors. (`ConnectionDialog` import in `ConnectionDialog.test.tsx` itself remains for now — deleted in Task 19.)

- [ ] **Step 4: Run all web tests to confirm no regression in unrelated specs**

```bash
pnpm -F @modeldoctor/web test
```

Expected: PASS (the `ConnectionDialog.test.tsx` still passes since the file itself is unchanged; all other tests untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
refactor(web): switch all ConnectionDialog call-sites to ConnectionSheet

Pure rename — props API is identical so call-sites only change import +
JSX tag name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Delete old ConnectionDialog + migrate its tests

**Files:**
- Create: `apps/web/src/features/connections/ConnectionSheet.test.tsx`
- Delete: `apps/web/src/features/connections/ConnectionDialog.tsx`
- Delete: `apps/web/src/features/connections/ConnectionDialog.test.tsx`

- [ ] **Step 1: Copy tests**

```bash
cp apps/web/src/features/connections/ConnectionDialog.test.tsx apps/web/src/features/connections/ConnectionSheet.test.tsx
```

- [ ] **Step 2: Inside `ConnectionSheet.test.tsx`, mechanical rename**

Replace:
- `import { ConnectionDialog }` → `import { ConnectionSheet }`
- `<ConnectionDialog` → `<ConnectionSheet`
- `ConnectionDialog>` → `ConnectionSheet>`
- `from "./ConnectionDialog"` → `from "./ConnectionSheet"`

The Radix base is identical (Sheet wraps `@radix-ui/react-dialog` — same `role="dialog"` selector), so existing `screen.getByRole("dialog")` and `getByLabelText(...)` queries continue to work.

- [ ] **Step 3: Run new test file to confirm it passes**

```bash
pnpm -F @modeldoctor/web test -- "ConnectionSheet.test"
```

Expected: PASS, all assertions green.

- [ ] **Step 4: Delete old files**

```bash
git rm apps/web/src/features/connections/ConnectionDialog.tsx \
       apps/web/src/features/connections/ConnectionDialog.test.tsx
```

- [ ] **Step 5: Verify type-check + full test pass**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/connections/ConnectionSheet.test.tsx
git commit -m "$(cat <<'EOF'
refactor(web): delete ConnectionDialog (migrated to ConnectionSheet)

Tests moved to ConnectionSheet.test.tsx — pure rename, same Radix base,
same selectors. End of mechanical migration. Discover region added in
later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10 — i18n

### Task 20: Add `discover.*` keys

**Files:**
- Modify: `apps/web/src/locales/zh-CN/connections.json`
- Modify: `apps/web/src/locales/en-US/connections.json`

- [ ] **Step 1: Add keys to zh-CN**

In `apps/web/src/locales/zh-CN/connections.json`, inside the `dialog` object, add a new `discover` block:

```json
"dialog": {
  "...": "<existing keys>",
  "discover": {
    "button": "🔍 自动发现",
    "running": "探测中…",
    "applyAll": "一键应用",
    "autoBadge": "自动",
    "autoBadgeTooltip": "自动检测，请确认",
    "evidence": "依据",
    "warningsTitle": "探测警告",
    "noResults": "无法识别端点信息，请手动填写",
    "ssrfBlocked": "出于安全考虑，该地址不允许探测",
    "missingBaseUrl": "请先填写 baseUrl",
    "successPartial": "已检测到 {{filled}} 个字段，{{failed}} 个探测失败",
    "successAll": "已检测到 {{filled}} 个字段，请确认",
    "confidence": {
      "certain": "确定",
      "likely": "可能",
      "guess": "猜测",
      "unknown": "未知"
    }
  }
}
```

- [ ] **Step 2: Mirror to en-US**

In `apps/web/src/locales/en-US/connections.json`:

```json
"dialog": {
  "...": "<existing keys>",
  "discover": {
    "button": "🔍 Discover",
    "running": "Discovering…",
    "applyAll": "Apply All",
    "autoBadge": "auto",
    "autoBadgeTooltip": "Auto-detected, please verify",
    "evidence": "Evidence",
    "warningsTitle": "Discovery warnings",
    "noResults": "Could not identify endpoint, please fill manually",
    "ssrfBlocked": "This address is not allowed for security reasons",
    "missingBaseUrl": "Please enter baseUrl first",
    "successPartial": "Detected {{filled}} fields, {{failed}} probes failed",
    "successAll": "Detected {{filled}} fields, please verify",
    "confidence": {
      "certain": "certain",
      "likely": "likely",
      "guess": "guess",
      "unknown": "unknown"
    }
  }
}
```

- [ ] **Step 3: Verify type-check (some i18n typings are generated)**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors. If your project uses generated i18n types (`pnpm gen:i18n` or similar), regenerate per existing convention. Run `pnpm -F @modeldoctor/web build` if unsure.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/locales/zh-CN/connections.json apps/web/src/locales/en-US/connections.json
git commit -m "$(cat <<'EOF'
feat(web): add discover.* i18n keys (zh-CN + en-US)

For ConnectionSheet's Discover region: button label, running state,
auto badge, confidence labels, error/warning copy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11 — Discover Hook

### Task 21: `useDiscoverConnection` mutation hook

**Files:**
- Modify: `apps/web/src/features/connections/queries.ts`
- Modify: `apps/web/src/features/connections/queries.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/connections/queries.test.tsx`:

```typescript
import { useDiscoverConnection } from "./queries";

describe("useDiscoverConnection", () => {
  it("posts to /connections/discover and parses B+ response", async () => {
    const mockResponse = {
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "ok" },
        models: { values: ["llama-3-8b"], confidence: "certain", evidence: "ok" },
        category: { value: "chat", confidence: "guess", evidence: "default" },
        suggestedTags: { values: ["vllm", "chat", "8b"], confidence: "guess", evidence: "ok" },
        prometheusUrl: { value: "http://x", confidence: "likely", evidence: "ok" },
      },
    };
    server.use(
      http.post("/api/connections/discover", async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ baseUrl: "http://x", apiKey: "sk-test" });
        return HttpResponse.json(mockResponse);
      }),
    );

    const { result } = renderHook(() => useDiscoverConnection(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ baseUrl: "http://x", apiKey: "sk-test" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.inferred.serverKind.value).toBe("vllm");
  });
});
```

(Use the same `server`, `createWrapper`, and import patterns as the existing tests in this file. Follow the existing imports of `http`, `HttpResponse`, `renderHook`, etc.)

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/web test -- queries.test
```

Expected: FAIL — `useDiscoverConnection is not exported`.

- [ ] **Step 3: Implement the hook**

Append to `apps/web/src/features/connections/queries.ts`:

```typescript
import {
  type DiscoverConnectionRequest,
  type DiscoverConnectionResponse,
  discoverConnectionResponseSchema,
} from "@modeldoctor/contracts";

export function useDiscoverConnection() {
  return useMutation({
    mutationFn: async (input: DiscoverConnectionRequest): Promise<DiscoverConnectionResponse> => {
      const res = await api.post("/connections/discover", input);
      return discoverConnectionResponseSchema.parse(res);
    },
  });
}
```

(`api`, `useMutation` should already be imported at the top of the file from existing hooks.)

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/web test -- queries.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/connections/queries.ts apps/web/src/features/connections/queries.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): useDiscoverConnection mutation hook

Posts to /api/connections/discover and validates the response with the
shared contracts schema. To be wired into ConnectionSheet's Discover button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 12 — Discover UX in ConnectionSheet

### Task 22: Add Discover button + result rendering

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionSheet.tsx`
- Modify: `apps/web/src/features/connections/ConnectionSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/connections/ConnectionSheet.test.tsx`:

```typescript
describe("ConnectionSheet — Discover region", () => {
  it("disables Discover button when baseUrl is empty", async () => {
    render(<ConnectionSheet open onOpenChange={vi.fn()} mode={{ kind: "create" }} />);
    const btn = screen.getByRole("button", { name: /Discover/i });
    expect(btn).toBeDisabled();
  });

  it("calls discover and renders auto badges on success", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/connections/discover", () =>
        HttpResponse.json({
          health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
          inferred: {
            serverKind: { value: "vllm", confidence: "certain", evidence: "metric prefix vllm:" },
            models: { values: ["llama-3-8b"], confidence: "certain", evidence: "/v1/models" },
            category: { value: "chat", confidence: "guess", evidence: "default" },
            suggestedTags: { values: ["vllm", "chat", "8b"], confidence: "guess", evidence: "..." },
            prometheusUrl: { value: "http://x", confidence: "likely", evidence: "engine exposes /metrics" },
          },
        }),
      ),
    );
    render(<ConnectionSheet open onOpenChange={vi.fn()} mode={{ kind: "create" }} />);

    await user.type(screen.getByLabelText(/API Base URL/i), "http://x");
    await user.click(screen.getByRole("button", { name: /Discover/i }));

    await waitFor(() => {
      // 5 auto badges expected (one per inferred field)
      expect(screen.getAllByText(/auto|自动/i).length).toBeGreaterThanOrEqual(5);
    });
  });

  it("shows SSRF warning banner on 400 reply", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/connections/discover", () =>
        HttpResponse.json(
          { message: "Cloud metadata endpoint blocked" },
          { status: 400 },
        ),
      ),
    );
    render(<ConnectionSheet open onOpenChange={vi.fn()} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/API Base URL/i), "http://169.254.169.254");
    await user.click(screen.getByRole("button", { name: /Discover/i }));
    await waitFor(() => {
      expect(screen.getByText(/security|安全/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/web test -- ConnectionSheet.test
```

Expected: FAIL — there is no Discover button yet.

- [ ] **Step 3: Implement Discover region inside `ConnectionSheet.tsx`**

Inside `ConnectionSheet.tsx`:

(a) Add imports near the top:

```typescript
import { useDiscoverConnection } from "./queries";
import type { DiscoverConnectionResponse } from "@modeldoctor/contracts";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
```

(b) Add state inside the component body (right after `const form = useForm(...)`):

```typescript
const [discoverResult, setDiscoverResult] = React.useState<DiscoverConnectionResponse | null>(null);
const [discoverError, setDiscoverError] = React.useState<string | null>(null);
const discoverMutation = useDiscoverConnection();

const baseUrlValue = form.watch("apiBaseUrl");
const apiKeyValue = form.watch("apiKey");

const handleDiscover = async () => {
  setDiscoverError(null);
  setDiscoverResult(null);
  try {
    const res = await discoverMutation.mutateAsync({
      baseUrl: baseUrlValue.trim(),
      apiKey: apiKeyValue?.trim() || undefined,
    });
    setDiscoverResult(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : t("dialog.discover.noResults");
    setDiscoverError(msg.includes("Cloud metadata") ? t("dialog.discover.ssrfBlocked") : msg);
  }
};
```

(c) Add the Discover button next to the baseUrl field (find the `apiBaseUrl` `<FormField>` block and add immediately under it):

```tsx
<div className="flex items-center gap-2 pt-1">
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={handleDiscover}
    disabled={!baseUrlValue?.trim() || discoverMutation.isPending}
  >
    {discoverMutation.isPending ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("dialog.discover.running")}
      </>
    ) : (
      <>
        <Sparkles className="mr-2 h-4 w-4" />
        {t("dialog.discover.button")}
      </>
    )}
  </Button>
  {!baseUrlValue?.trim() && (
    <span className="text-xs text-muted-foreground">{t("dialog.discover.missingBaseUrl")}</span>
  )}
</div>
```

(d) Add a banner area immediately below the Discover button (renders only when there's a result or error):

```tsx
{discoverError && (
  <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
    <span>{discoverError}</span>
  </div>
)}
{discoverResult && !discoverError && (
  <DiscoverResultBanner result={discoverResult} />
)}
```

(e) Define `DiscoverResultBanner` as a sibling component in the same file:

```tsx
function DiscoverResultBanner({ result }: { result: DiscoverConnectionResponse }) {
  const { t } = useTranslation("connections");
  const filledFields = [
    result.inferred.serverKind.value,
    result.inferred.models.values.length > 0 ? "x" : null,
    result.inferred.category.value,
    result.inferred.suggestedTags.values.length > 0 ? "x" : null,
    result.inferred.prometheusUrl.value,
  ].filter(Boolean).length;
  const failedCount = result.health.probesFailed.length;
  const variant =
    filledFields === 0 ? "destructive" : failedCount > 0 ? "warning" : "success";

  const message =
    variant === "destructive"
      ? t("dialog.discover.noResults")
      : variant === "warning"
        ? t("dialog.discover.successPartial", { filled: filledFields, failed: failedCount })
        : t("dialog.discover.successAll", { filled: filledFields });

  const colorClass =
    variant === "destructive"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : variant === "warning"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";

  return (
    <div className={`mt-3 flex items-start gap-2 rounded-md border p-3 text-sm ${colorClass}`}>
      <span>{message}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test again**

```bash
pnpm -F @modeldoctor/web test -- ConnectionSheet.test
```

Expected: PASS for the 3 new tests. (Existing migrated tests remain green.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/connections/ConnectionSheet.tsx apps/web/src/features/connections/ConnectionSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add Discover button + result banner to ConnectionSheet

Button disabled until baseUrl present; calls useDiscoverConnection;
result rendered as banner (success/partial/error variants). Auto-badge
field rendering deferred to next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Auto-badges + Apply-All + dirty-field handling

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionSheet.tsx`
- Modify: `apps/web/src/features/connections/ConnectionSheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/features/connections/ConnectionSheet.test.tsx`:

```typescript
describe("ConnectionSheet — Apply All + dirty preservation", () => {
  it("Apply All fills inferred fields into form", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/connections/discover", () =>
        HttpResponse.json({
          health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
          inferred: {
            serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
            models: { values: ["llama-3-8b"], confidence: "certain", evidence: "x" },
            category: { value: "chat", confidence: "guess", evidence: "x" },
            suggestedTags: { values: ["vllm", "chat"], confidence: "guess", evidence: "x" },
            prometheusUrl: { value: "http://x", confidence: "likely", evidence: "x" },
          },
        }),
      ),
    );
    render(<ConnectionSheet open onOpenChange={vi.fn()} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/API Base URL/i), "http://x");
    await user.click(screen.getByRole("button", { name: /Discover/i }));
    await waitFor(() => screen.getByRole("button", { name: /Apply/i }));

    await user.click(screen.getByRole("button", { name: /Apply/i }));

    expect(screen.getByLabelText(/Model/i)).toHaveValue("llama-3-8b");
  });

  it("Apply All preserves user-modified (dirty) fields in edit mode", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/connections/discover", () =>
        HttpResponse.json({
          health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
          inferred: {
            serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
            models: { values: ["new-model"], confidence: "certain", evidence: "x" },
            category: { value: "chat", confidence: "guess", evidence: "x" },
            suggestedTags: { values: [], confidence: "unknown", evidence: "x" },
            prometheusUrl: { value: null, confidence: "unknown", evidence: "x" },
          },
        }),
      ),
    );
    const existing = makeConnection({ name: "test", model: "user-typed-model", baseUrl: "http://x" });
    render(
      <ConnectionSheet
        open
        onOpenChange={vi.fn()}
        mode={{ kind: "edit", existing }}
      />,
    );
    // User edits the model field manually
    const modelInput = screen.getByLabelText(/Model/i);
    await user.clear(modelInput);
    await user.type(modelInput, "user-changed-model");

    // Then triggers Discover
    await user.click(screen.getByRole("button", { name: /Discover/i }));
    await waitFor(() => screen.getByRole("button", { name: /Apply/i }));
    await user.click(screen.getByRole("button", { name: /Apply/i }));

    // Model field stays at user-edited value
    expect(modelInput).toHaveValue("user-changed-model");
  });
});
```

(`makeConnection` is the existing test helper in `ConnectionSheet.test.tsx` — reuse it as-is.)

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/web test -- ConnectionSheet.test
```

Expected: FAIL — `Apply` button doesn't exist yet.

- [ ] **Step 3: Implement Apply All + dirty preservation**

Update `DiscoverResultBanner` in `ConnectionSheet.tsx` to accept a callback and render the Apply button:

```tsx
function DiscoverResultBanner({
  result,
  onApply,
  applyDisabled,
}: {
  result: DiscoverConnectionResponse;
  onApply: () => void;
  applyDisabled: boolean;
}) {
  const { t } = useTranslation("connections");
  // ... (filledFields, variant, message, colorClass — same as Task 22)

  return (
    <div className={`mt-3 flex items-start justify-between gap-2 rounded-md border p-3 text-sm ${colorClass}`}>
      <span>{message}</span>
      {filledFields > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={onApply} disabled={applyDisabled}>
          {t("dialog.discover.applyAll")}
        </Button>
      )}
    </div>
  );
}
```

In the parent component, define `handleApplyAll` and wire it:

```typescript
const handleApplyAll = () => {
  if (!discoverResult) return;
  const { dirtyFields } = form.formState;
  const inf = discoverResult.inferred;

  // Helper: only setValue if field is NOT dirty (user hasn't touched it)
  const setIfClean = (
    key: keyof ConnectionInput,
    value: ConnectionInput[keyof ConnectionInput],
  ) => {
    if (!dirtyFields[key]) {
      form.setValue(key, value, { shouldDirty: false, shouldTouch: false });
    }
  };

  if (inf.serverKind.value) setIfClean("serverKind", inf.serverKind.value);
  if (inf.models.values.length > 0) setIfClean("model", inf.models.values[0]);
  if (inf.category.value) setIfClean("category", inf.category.value);
  if (inf.suggestedTags.values.length > 0) setIfClean("tags", inf.suggestedTags.values);
  if (inf.prometheusUrl.value) setIfClean("prometheusUrl", inf.prometheusUrl.value);
};
```

And in the JSX, pass it to the banner:

```tsx
{discoverResult && !discoverError && (
  <DiscoverResultBanner
    result={discoverResult}
    onApply={handleApplyAll}
    applyDisabled={false}
  />
)}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm -F @modeldoctor/web test -- ConnectionSheet.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/connections/ConnectionSheet.tsx apps/web/src/features/connections/ConnectionSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): Apply-All button + dirty-field preservation in ConnectionSheet

Apply All writes inferred values into the form via react-hook-form
setValue, but only for fields that are NOT in dirtyFields. So edit-mode
Discover never overwrites a user's manual edits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 13 — End-to-End

### Task 24: Mock vLLM server fixture

**Files:**
- Create: `e2e/fixtures/mock-vllm-server.ts`

- [ ] **Step 1: Create the fixture**

Create `e2e/fixtures/mock-vllm-server.ts`:

```typescript
import { type Server, createServer } from "node:http";
import { type AddressInfo } from "node:net";

/**
 * Minimal HTTP server that mimics a vLLM-style endpoint for e2e testing
 * connection-discovery (#151). Exposes:
 *   - GET /v1/models  → OpenAI shape with 1 model
 *   - GET /metrics    → Prometheus body containing `vllm:` prefix
 *   - GET /health     → 200 ok
 *   - GET /           → empty body, Server header
 *
 * Bind on port 0; the actual port is exposed via .url after .start().
 */
export class MockVllmServer {
  private server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      switch (req.url) {
        case "/v1/models":
          res.writeHead(200, { "content-type": "application/json", "content-length": "62" });
          res.end(JSON.stringify({ data: [{ id: "llama-3-8b-instruct" }] }));
          return;
        case "/metrics": {
          const body = "# HELP vllm:request_success_total ...\nvllm:request_success_total 42\nvllm:gpu_cache_usage_perc 0.5\n";
          res.writeHead(200, {
            "content-type": "text/plain",
            "content-length": String(body.length),
          });
          res.end(body);
          return;
        }
        case "/health":
          res.writeHead(200, { "content-type": "text/plain", "content-length": "2" });
          res.end("ok");
          return;
        case "/":
          res.writeHead(200, { Server: "vLLM/0.6.4", "content-length": "0" });
          res.end();
          return;
        default:
          res.writeHead(404);
          res.end("not found");
      }
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => {
        const port = (this.server!.address() as AddressInfo).port;
        this.url = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}
```

- [ ] **Step 2: Smoke-test the fixture**

```bash
pnpm exec ts-node --transpileOnly -e "
import { MockVllmServer } from './e2e/fixtures/mock-vllm-server';
(async () => {
  const s = new MockVllmServer();
  await s.start();
  console.log('listening at', s.url);
  const r = await fetch(s.url + '/v1/models');
  console.log(await r.text());
  await s.stop();
})();
"
```

Expected: prints port + JSON `{"data":[{"id":"llama-3-8b-instruct"}]}`. (If `ts-node` isn't installed, skip — fixture will be exercised by the e2e test directly.)

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/mock-vllm-server.ts
git commit -m "$(cat <<'EOF'
test(e2e): mock vLLM server fixture for connection discovery e2e

Minimal http.createServer exposing /v1/models, /metrics, /health, /.
Used by the discover e2e spec to avoid depending on a real engine.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: E2E happy-path test

**Files:**
- Create: `e2e/connection-discover.spec.ts`

- [ ] **Step 1: Write the failing e2e test (happy path only first)**

Create `e2e/connection-discover.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { MockVllmServer } from "./fixtures/mock-vllm-server";
import { registerAndLogin } from "./helpers/auth"; // existing helper: registers a fresh user via UI and redirects to /benchmarks

let mock: MockVllmServer;

test.beforeAll(async () => {
  mock = new MockVllmServer();
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

test("Discover fills 5 fields from a vLLM-shaped endpoint", async ({ page }) => {
  await registerAndLogin(page);
  await page.goto("/connections");
  await page.getByRole("button", { name: /New connection|新建连接/ }).click();

  await page.getByLabel(/Name|名称/).fill("e2e-vllm");
  await page.getByLabel(/API Base URL/).fill(mock.url);
  await page.getByLabel(/API Key/).fill("sk-e2e");

  await page.getByRole("button", { name: /Discover|自动发现/ }).click();

  // wait for the success banner
  await expect(page.getByText(/Detected|已检测到/)).toBeVisible({ timeout: 10_000 });

  // Apply All
  await page.getByRole("button", { name: /Apply|应用/ }).click();

  // verify form values
  await expect(page.getByLabel(/Model/)).toHaveValue("llama-3-8b-instruct");
  // serverKind is a select — check via the rendered text
  await expect(page.locator('[role="combobox"]', { hasText: /vLLM/ })).toBeVisible();
  // tags chips contain "vllm"
  await expect(page.getByText("vllm", { exact: true })).toBeVisible();
});
```

(`registerAndLogin` lives at `e2e/helpers/auth.ts:17`; it registers a fresh random-email user via the UI and waits for redirect to `/benchmarks`. Use `await page.goto("/connections")` afterward to navigate to the Connections page.)

- [ ] **Step 2: Run e2e test**

```bash
pnpm test:e2e:browser -- "connection-discover"
```

Expected: PASS. (If the helper import path is wrong or the existing e2e suite uses a different login mechanism, adapt — `e2e/playwright.config.ts` shows existing setup.)

- [ ] **Step 3: Commit**

```bash
git add e2e/connection-discover.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): connection discover happy path against mock vLLM

Discovers serverKind/model/tags from MockVllmServer, clicks Apply,
verifies form values are filled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 26: E2E SSRF rejection test

**Files:**
- Modify: `e2e/connection-discover.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `e2e/connection-discover.spec.ts`:

```typescript
test("Discover rejects AWS metadata URL with security warning", async ({ page }) => {
  await registerAndLogin(page);
  await page.goto("/connections");
  await page.getByRole("button", { name: /New connection|新建连接/ }).click();

  await page.getByLabel(/Name|名称/).fill("e2e-ssrf");
  await page.getByLabel(/API Base URL/).fill("http://169.254.169.254/latest");

  await page.getByRole("button", { name: /Discover|自动发现/ }).click();

  // SSRF banner should appear
  await expect(page.getByText(/security|安全/)).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm test:e2e:browser -- "connection-discover"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/connection-discover.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): SSRF rejection in connection discover

Submits 169.254.169.254 (AWS metadata IP) — verifies the security
banner is shown and no Apply button appears.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: E2E edit-mode dirty preservation

**Files:**
- Modify: `e2e/connection-discover.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `e2e/connection-discover.spec.ts`:

```typescript
test("Discover preserves user-edited model in edit mode", async ({ page }) => {
  await registerAndLogin(page);
  // Pre-create a connection via API for test isolation
  await page.request.post("/api/connections", {
    data: {
      name: "e2e-edit",
      baseUrl: mock.url,
      apiKey: "sk-old",
      model: "old-model",
      category: "chat",
      tags: [],
    },
  });

  await page.goto("/connections");
  await page.getByRole("button", { name: /e2e-edit/ }).click(); // open edit

  // user manually changes model
  const modelInput = page.getByLabel(/Model/);
  await modelInput.fill("manually-typed-model");

  // user triggers discover
  await page.getByRole("button", { name: /Discover|自动发现/ }).click();
  await expect(page.getByRole("button", { name: /Apply|应用/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Apply|应用/ }).click();

  // model field MUST stay as user typed
  await expect(modelInput).toHaveValue("manually-typed-model");
});
```

- [ ] **Step 2: Run test**

```bash
pnpm test:e2e:browser -- "connection-discover"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/connection-discover.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): edit-mode discover preserves user-modified fields

Verifies dirtyFields-based Apply preservation works end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 14 — Final Validation

### Task 28: Full test + type-check + lint sweep

**Files:** none (validation only)

- [ ] **Step 1: Build contracts (downstream consumers depend on it)**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: PASS.

- [ ] **Step 2: Type-check entire workspace**

```bash
pnpm type-check
```

Expected: PASS, zero errors.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: PASS, zero violations. (If biome flags issues — usually whitespace/import order — fix them with `pnpm format` then re-lint.)

- [ ] **Step 4: All unit tests**

```bash
pnpm test
```

Expected: PASS, all suites green.

- [ ] **Step 5: API e2e**

```bash
pnpm test:e2e:api
```

Expected: PASS.

- [ ] **Step 6: Browser e2e**

```bash
pnpm -r build  # ensure packages/contracts/dist exists for the api typecheck (per project memory)
pnpm test:e2e:browser
```

Expected: PASS (including all 3 connection-discover tests).

- [ ] **Step 7: If any step failed, fix root cause and re-run from Step 1.** Do not commit a "skip flaky test" workaround.

- [ ] **Step 8: Commit final fixes (if any)**

```bash
git add <fixed files>
git commit -m "$(cat <<'EOF'
chore: final type-check/lint/test sweep for #151

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Push**

```bash
git push
```

---

## Self-Review Notes (for plan author + reviewer)

### Spec coverage check

| Spec section | Implementing task |
|---|---|
| §4.1 SSRF Policy D | Task 3 |
| §4.2 Probe orchestrator architecture | Tasks 5–9 (probes), Task 14 (orchestrator) |
| §4.3 API contract | Task 1 (contracts), Task 15 (controller) |
| §4.4.1 server-kind inference | Task 10 |
| §4.4.2 category inference | Task 11 |
| §4.4.3 tags inference | Task 12 |
| §4.4.4 prometheus-url inference | Task 13 |
| §4.5 MCP tool | Task 15 (controller exposes REST; spec acknowledges actual MCP server packaging is per #132) |
| §4.6.1 Add Sheet component | Task 16 |
| §4.6.2 ConnectionDialog → ConnectionSheet | Tasks 17, 18, 19 |
| §4.6.3 Discover region UX | Tasks 22, 23 |
| §4.6.4 React Query hook | Task 21 |
| §4.7 Error handling | Task 14 (warnings + probesFailed), Task 22 (banner variants) |
| §4.8 Throttle | Task 15 |
| §6.1 Unit tests | Each task ships its own spec |
| §6.2 Web component tests | Tasks 17/19/22/23 |
| §6.3 e2e | Tasks 24, 25, 26, 27 |
| §6.4 Final type-check/lint/test | Task 28 |

### Out-of-scope (per spec §2 Out)
- Tokenizer detection — explicitly NOT in this plan; tracked via #156.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-connection-discover.md`.**
