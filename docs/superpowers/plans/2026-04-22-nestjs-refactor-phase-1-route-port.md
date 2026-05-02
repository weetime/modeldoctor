> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# NestJS Refactor — Phase 1 Implementation Plan (Port 4 Routes to Nest)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 4 HTTP endpoints (`/api/health`, `/api/check-vegeta`, `/api/e2e-test`, `/api/load-test`, `/api/debug/proxy`) in `apps/api` (NestJS) so the frontend — which has been returning "Not Found" since Phase 0's scaffold landed — works end-to-end against the new backend. Populate `packages/contracts/src/` with Zod schemas as the shared source of truth for request/response shapes. Preserve wire-format parity with the pre-Phase-0 Express implementation (whose source is recoverable from git history at commit `877ba8f~1`).

**Architecture:** One Nest module per endpoint under `apps/api/src/modules/`, each with its own controller + service. Pure-function layers (builders, parsers, probes, utils) are restored from git history and translated from CJS JavaScript to strict TypeScript under `apps/api/src/integrations/`. Zod schemas live in `packages/contracts/src/` and are consumed on both sides of the wire (FE via `z.infer`, BE via `ZodValidationPipe`). Cross-cutting infrastructure (validation pipe, exception filter) lives under `apps/api/src/common/`. Error responses preserve the legacy `{ success: false, error: string }` shape so the FE's existing `api-client.ts` error handling works unchanged — the richer error envelope from spec §4.3 arrives in Phase 2.

**Tech Stack:** NestJS 10 (Express adapter), TypeScript 5 strict, Zod 3, Vitest + SWC, supertest. Node ≥ 20 native `fetch` (no axios). No Prisma, no Passport, no Pino yet — those are Phase 2+.

**Source spec:** `docs/superpowers/specs/2026-04-22-nestjs-backend-refactor-design.md` (Phase 1, §5)
**Prior plan (completed):** `docs/superpowers/plans/2026-04-22-nestjs-refactor-phase-0-workspace-scaffold.md`

**Critical deviation from spec:** §2.3 required capturing Express fixtures before Phase 1. Phase 0 instead deleted the old Express backend without capturing fixtures (explicit user decision). Consequence for this plan: parity is verified via Zod schema round-trips + e2e tests for error paths + manual FE smoke — **not** byte-level fixture comparison. Happy-path wire format is derived from (a) FE TypeScript types in `apps/web/src/features/*/types.ts` and (b) reading the legacy JS via `git show 877ba8f~1:src/routes/<name>.js` (SHA stable; the files are gone from the working tree but preserved in history).

**Testing discipline:**
- **TDD for pure logic**: write Zod schema tests first (parse valid → pass, parse invalid → fail), then integrations (builders/parsers), then services.
- **e2e (supertest) for every endpoint**: at minimum covers validation errors (deterministic, no upstream needed). Happy-path e2e is best-effort — most endpoints need an external model API, so happy-path runs in manual smoke instead of CI. For `/api/debug/proxy`, a local in-memory upstream (a tiny `http.createServer` inside the test) is used to cover the forwarding path.
- **No nock / msw dependency**: native `http` for test upstream servers keeps the dep tree small.
- **No new snapshot tests**: behaviour assertions are explicit (`expect(body).toEqual(...)`), not snapshot-based — Phase 0 showed that snapshot-style fixtures were the wrong shape for this codebase.

**Commit cadence:** One commit per task. Prefix convention inherited from Phase 0:
- `refactor:` restoring/translating existing logic
- `feat:` new runtime functionality (controller + service + route)
- `build:` tooling / config
- `test:` test-only changes
- `fix:` bug fix
- `docs:` README / plan / spec updates
- `chore:` housekeeping

**Environment assumptions:**
- Working directory: `/Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1` (worktree pre-created, `pnpm install` pre-run).
- Node ≥ 20, pnpm 9.
- No Vegeta or live model API needed for Tasks 1–10's green bar. Task 11's manual smoke exercises live upstreams if you want to.

---

## Pre-flight

- [ ] **Step 0.1: Confirm you are in the `feat/nestjs-phase-1` worktree**

Run:
```bash
pwd && git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 branch --show-current
```
Expected: pwd is `/Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1`; branch is `feat/nestjs-phase-1`.

- [ ] **Step 0.2: Confirm baseline (Phase 0 deliverables still work)**

Run:
```bash
pnpm -r type-check
pnpm -r test
```
Expected: type-check green across `@modeldoctor/web`, `@modeldoctor/api`, `@modeldoctor/contracts`; tests green (62 web + 1 api smoke).

- [ ] **Step 0.3: Confirm the 4 endpoints are currently 404**

In one terminal:
```bash
pnpm dev
```
In another:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api          # 200 (Nest default scaffold)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health   # 404 (expected, Phase 1 fixes this)
```
Kill `pnpm dev`. This confirms the starting point.

- [ ] **Step 0.4: Confirm legacy source recovery works**

Run:
```bash
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/routes/health.js | head -5
```
Expected: prints the first 5 lines of the old `health.js` (`const express = require("express");` etc.). If this fails with "unknown revision", fall back to: `git log --oneline main -- server.js` to find the last commit touching `server.js`, then use `<that-sha>:src/...`.

---

## Task 1: Restore request builders (CJS JS → strict TS)

**Files:**
- Create: `apps/api/src/integrations/builders/chat.ts`
- Create: `apps/api/src/integrations/builders/embeddings.ts`
- Create: `apps/api/src/integrations/builders/images.ts`
- Create: `apps/api/src/integrations/builders/multimodal.ts`
- Create: `apps/api/src/integrations/builders/rerank.ts`
- Create: `apps/api/src/integrations/builders/index.ts`
- Test: `apps/api/src/integrations/builders/builders.spec.ts`

**What these are:** pure functions that take a request-config object (model, prompt, temperature, etc.) and return the JSON body for the corresponding OpenAI-compatible endpoint. No I/O, no state. The old source lives in git at `877ba8f~1:src/builders/*.js`.

- [ ] **Step 1.1: Read the legacy source**

Run:
```bash
for f in chat embeddings images multimodal rerank index; do
  echo "=== $f ==="
  git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/builders/$f.js
done
```
Skim each. `index.js` exports the `buildRequestBody(apiType, opts)` dispatcher plus `VALID_API_TYPES`. The rest are per-type body builders.

- [ ] **Step 1.2: Translate one file at a time**

For each `<name>.js`, create `apps/api/src/integrations/builders/<name>.ts`. Translation rules:
- `const X = require("./y")` → `import { X } from "./y.js";` (NOTE: `.js` extension because TS `module: commonjs` with Node resolution accepts `.js` for `.ts` siblings; this matches Nest's scaffold style. If it doesn't — drop the extension.)
- `module.exports = { ... }` → `export const X = ...; export function Y(...) {...}`
- Add types:
  - Config object parameters: write an explicit `interface BuilderConfig { model: string; prompt: string; maxTokens: number; temperature: number; stream?: boolean; ... }` matching the fields the legacy JS actually reads. Don't over-type — reflect usage.
  - Return types: `Record<string, unknown>` for the returned body is acceptable since downstream fetchers serialize it. Can tighten later.
- Preserve behaviour **exactly**. If the legacy JS does `prompt ?? ""`, do the same. If it coerces `maxTokens` to number, keep that coercion.

`index.ts` specifically:
```typescript
import { buildChatBody } from "./chat.js";
import { buildEmbeddingsBody } from "./embeddings.js";
import { buildImagesBody } from "./images.js";
import { buildMultimodalBody } from "./multimodal.js";
import { buildRerankBody } from "./rerank.js";

export const VALID_API_TYPES = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
] as const;

export type ApiType = (typeof VALID_API_TYPES)[number];

export function buildRequestBody(
  apiType: ApiType,
  opts: Record<string, unknown>,
): Record<string, unknown> {
  switch (apiType) {
    case "chat":
      return buildChatBody(opts);
    case "embeddings":
      return buildEmbeddingsBody(opts);
    case "images":
      return buildImagesBody(opts);
    case "rerank":
      return buildRerankBody(opts);
    case "chat-vision":
    case "chat-audio":
      return buildMultimodalBody(apiType, opts);
    default: {
      const exhaustive: never = apiType;
      throw new Error(`Unknown apiType: ${String(exhaustive)}`);
    }
  }
}
```
Adjust function names and signatures to match what the legacy `index.js` actually does (read the file first).

- [ ] **Step 1.3: Write a smoke spec for builders**

Create `apps/api/src/integrations/builders/builders.spec.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildRequestBody, VALID_API_TYPES } from "./index.js";

describe("buildRequestBody", () => {
  it("accepts every declared api type without throwing", () => {
    const minimalOpts = {
      model: "m",
      prompt: "hi",
      input: "hi",
      query: "q",
      texts: "a\nb",
      imageUrl: "data:image/png;base64,AAAA",
      maxTokens: 8,
      temperature: 0.1,
      size: "256x256",
      n: 1,
    };
    for (const t of VALID_API_TYPES) {
      expect(() => buildRequestBody(t, minimalOpts)).not.toThrow();
    }
  });

  it("rejects an unknown apiType at the type level (runtime throw)", () => {
    expect(() => buildRequestBody("bogus" as never, {})).toThrow(/Unknown apiType/);
  });
});
```

- [ ] **Step 1.4: Run the spec**

```bash
pnpm -F @modeldoctor/api test
```
Expected: the existing smoke spec from Phase 0 still passes (1 test), plus the new builders spec passes (2 tests). Total 3 tests passing.

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/integrations/builders
git commit -m "refactor(api): port request builders from CJS JS to strict TS"
```

---

## Task 2: Restore parsers + utils (CJS JS → strict TS, binary asset)

**Files:**
- Create: `apps/api/src/integrations/parsers/vegeta-report.ts`
- Create: `apps/api/src/integrations/utils/tiny-png.ts`
- Create: `apps/api/src/integrations/utils/wav.ts`
- Create: `apps/api/src/integrations/assets/cat.jpg` (binary, restored from git)
- Test: `apps/api/src/integrations/parsers/vegeta-report.spec.ts`

**What these are:**
- `parsers/vegeta-report.ts`: parses Vegeta CLI's stdout (text table) into a structured `LoadTestParsed` object.
- `utils/tiny-png.ts`: returns a tiny valid PNG as base64 (for image probe).
- `utils/wav.ts`: synthesises a short WAV clip (for audio probe).
- `assets/cat.jpg`: real JPEG image used by the image probe's multimodal checks.

- [ ] **Step 2.1: Restore the binary asset**

Run:
```bash
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/probes/assets/cat.jpg > apps/api/src/integrations/assets/cat.jpg
ls -la apps/api/src/integrations/assets/cat.jpg
```
Expected: `cat.jpg` exists, size matches the git blob (sha `f251dd0c51a6f321aed5297fce64396e01a23db1`). Check:
```bash
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 hash-object apps/api/src/integrations/assets/cat.jpg
```
Expected: `f251dd0c51a6f321aed5297fce64396e01a23db1` (identical bytes).

- [ ] **Step 2.2: Translate the three JS files**

For each:
```bash
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/parsers/vegeta-report.js
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/utils/tiny-png.js
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/utils/wav.js
```
Translate to TS. Add types for the exported functions.

For `vegeta-report.ts`, the return type should be:
```typescript
export interface VegetaParsed {
  requests: number | null;
  success: number | null;
  throughput: number | null;
  latencies: {
    mean: string | null;
    p50: string | null;
    p95: string | null;
    p99: string | null;
    max: string | null;
  };
}

export function parseVegetaReport(output: string): VegetaParsed { /* ... */ }
```
This matches the FE's `LoadTestParsed` type at `apps/web/src/features/load-test/types.ts:12` — it's the same structure.

- [ ] **Step 2.3: TDD the parser with a captured Vegeta report sample**

Create `apps/api/src/integrations/parsers/vegeta-report.spec.ts` with a realistic Vegeta report as input (the ONE you'll see at `877ba8f~1:src/routes/debug-proxy.test.js` shows the format, or search online — sample is stable). Example:
```typescript
import { describe, it, expect } from "vitest";
import { parseVegetaReport } from "./vegeta-report.js";

const SAMPLE = `Requests      [total, rate, throughput]             10, 10.01, 9.87
Duration      [total, attack, wait]                1.013s, 999.062ms, 14.164ms
Latencies     [min, mean, 50, 90, 95, 99, max]     12.3ms, 45.6ms, 40ms, 60ms, 70ms, 100ms, 120ms
Bytes In      [total, mean]                        5000, 500.00
Bytes Out     [total, mean]                        1500, 150.00
Success       [ratio]                              100.00%
Status Codes  [code:count]                         200:10
Error Set:
`;

describe("parseVegetaReport", () => {
  it("extracts requests, throughput, success ratio, and latency percentiles", () => {
    const parsed = parseVegetaReport(SAMPLE);
    expect(parsed.requests).toBe(10);
    expect(parsed.throughput).toBeCloseTo(9.87, 2);
    expect(parsed.success).toBe(1);  // ratio as 0–1, or 100 as percent — MATCH what legacy parser does
    expect(parsed.latencies.mean).toBe("45.6ms");
    expect(parsed.latencies.p50).toBe("40ms");
    expect(parsed.latencies.p95).toBe("70ms");
    expect(parsed.latencies.p99).toBe("100ms");
    expect(parsed.latencies.max).toBe("120ms");
  });

  it("returns nulls for fields missing from malformed input", () => {
    const parsed = parseVegetaReport("garbage");
    expect(parsed.requests).toBeNull();
    expect(parsed.latencies.p50).toBeNull();
  });
});
```
**IMPORTANT**: read `877ba8f~1:src/parsers/vegeta-report.js` first to know what `success` is (0-1 ratio or 0-100 percent) and what `latencies.*` look like — assertions above are a template, match them to the legacy behaviour **exactly**.

- [ ] **Step 2.4: Run tests**

```bash
pnpm -F @modeldoctor/api test
```
Expected: all prior tests pass + 2 new parser tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/integrations/parsers apps/api/src/integrations/utils apps/api/src/integrations/assets
git commit -m "refactor(api): port parsers, utils, and cat.jpg asset from legacy src/"
```

---

## Task 3: Restore probes (CJS JS → strict TS)

**Files:**
- Create: `apps/api/src/integrations/probes/text.ts`
- Create: `apps/api/src/integrations/probes/image.ts`
- Create: `apps/api/src/integrations/probes/audio.ts`
- Create: `apps/api/src/integrations/probes/index.ts` (exports the dispatcher)

**What these are:** each probe takes a `ProbeCtx` `{ apiUrl, apiKey, model, extraHeaders }`, makes a real HTTP call to the upstream model, parses the response, and returns a `ProbeResult` (`{ pass, latencyMs, checks, details }`). The shape of `ProbeResult` must match FE's type at `apps/web/src/features/e2e-smoke/types.ts:9-24` byte-for-byte — **that is the contract**.

- [ ] **Step 3.1: Read the legacy probes**

```bash
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/probes/text.js
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/probes/image.js
git -C /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-1 show 877ba8f~1:src/probes/audio.js
```

- [ ] **Step 3.2: Translate each, declaring explicit types**

Define shared types at the top of `probes/index.ts`:
```typescript
export type ProbeName = "text" | "image" | "audio";

export interface ProbeCtx {
  apiUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
}

export interface ProbeCheck {
  name: string;
  pass: boolean;
  info?: string;
}

export interface ProbeResult {
  pass: boolean;
  latencyMs: number | null;
  checks: ProbeCheck[];
  details: {
    content?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
    imagePreviewB64?: string;
    imageMime?: string;
    audioB64?: string;
    audioBytes?: number;
    numChoices?: number;
    textReply?: string;
    error?: string;
  };
}

export type Probe = (ctx: ProbeCtx) => Promise<ProbeResult>;
```

Translation rules — same as Task 1 (CJS → ESM, types, preserve behaviour).

Path adjustment for `cat.jpg` access inside `image.ts`:
- Legacy: `require("fs").readFileSync(path.join(__dirname, "assets/cat.jpg"))`
- New: `fs.readFileSync(new URL("../assets/cat.jpg", import.meta.url))` (ESM-friendly). Or resolve via `path.join(__dirname, "..", "assets", "cat.jpg")` if tsc target is CommonJS (which our tsconfig has). **Check `apps/api/tsconfig.json` — if `module: commonjs` remains, `__dirname` is fine; otherwise use the `new URL(..., import.meta.url)` form.**

Export the dispatcher in `probes/index.ts`:
```typescript
import { runTextProbe } from "./text.js";
import { runImageProbe } from "./image.js";
import { runAudioProbe } from "./audio.js";

export const PROBES: Record<ProbeName, Probe> = {
  text: runTextProbe,
  image: runImageProbe,
  audio: runAudioProbe,
};
```

- [ ] **Step 3.3: No probe tests in this task**

Probes make live HTTP calls to upstream model APIs; unit-testing them requires upstream mocking. Task 7's e2e will exercise them against validation errors only. **Happy-path testing is manual** (Task 11). This is a deliberate tradeoff: not every pure function needs a unit test when it's a thin transport wrapper.

If you want a sanity check, run `pnpm -F @modeldoctor/api type-check` — any import or type errors surface here.

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/src/integrations/probes
git commit -m "refactor(api): port e2e-smoke probes (text/image/audio) to strict TS"
```

---

## Task 4: Define the shared error-response contract + ZodValidationPipe

**Files:**
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/common.ts` (re-exports)
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/common/pipes/zod-validation.pipe.ts`
- Create: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Test: `apps/api/src/common/pipes/zod-validation.pipe.spec.ts`

**Why this now:** every endpoint in Tasks 5–8 uses the pipe and expects errors shaped `{ success: false, error: string }` (matching legacy Express). Building it once here avoids repeating the infrastructure in each module.

- [ ] **Step 4.1: Add the error contract**

Create `packages/contracts/src/errors.ts`:
```typescript
import { z } from "zod";

/** Legacy-compatible error shape. Every non-2xx response from apps/api matches this. */
export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
```

Create `packages/contracts/src/common.ts`:
```typescript
import { z } from "zod";

/** Field present on some legacy success responses. Not all endpoints include it; those that do can extend their schema with .merge(SuccessFlagSchema). */
export const SuccessFlagSchema = z.object({
  success: z.literal(true),
});
```

Update `packages/contracts/src/index.ts`:
```typescript
export * from "./errors.js";
export * from "./common.js";
```

- [ ] **Step 4.2: Write `ZodValidationPipe`**

Create `apps/api/src/common/pipes/zod-validation.pipe.ts`:
```typescript
import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import type { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Collapse to the first issue for FE compatibility with legacy "error: string" shape.
    const first = result.error.issues[0];
    const path = first?.path.join(".") || "body";
    const message = first?.message || "Validation failed";
    throw new BadRequestException(`${path}: ${message}`);
  }
}
```

- [ ] **Step 4.3: Write `AllExceptionsFilter`**

Create `apps/api/src/common/filters/all-exceptions.filter.ts`:
```typescript
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object" && "message" in body) {
        const m = (body as { message: unknown }).message;
        message = Array.isArray(m) ? m.join("; ") : String(m);
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({ success: false, error: message });
  }
}
```

- [ ] **Step 4.4: Register the filter + pipe globally in `main.ts`**

Edit `apps/api/src/main.ts`. Add two lines inside `bootstrap` after `app.setGlobalPrefix("api")`:
```typescript
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
// ... (existing imports)

async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");
  app.useGlobalFilters(new AllExceptionsFilter());

  // ... existing CORS block, port bind, etc.
}
```
(The pipe is NOT registered globally — each controller method attaches it via `@UsePipes(new ZodValidationPipe(schema))` so each endpoint's contract is explicit in the controller.)

- [ ] **Step 4.5: TDD the pipe**

Create `apps/api/src/common/pipes/zod-validation.pipe.spec.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe.js";

describe("ZodValidationPipe", () => {
  const schema = z.object({ name: z.string(), age: z.number().int() });
  const meta = { type: "body" as const };

  it("returns parsed data when input is valid", () => {
    const pipe = new ZodValidationPipe(schema);
    const out = pipe.transform({ name: "x", age: 1 }, meta);
    expect(out).toEqual({ name: "x", age: 1 });
  });

  it("throws BadRequestException on first validation failure", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ name: 123 }, meta)).toThrow(BadRequestException);
  });

  it("includes field path and message in the thrown error", () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ name: 123 }, meta);
    } catch (e) {
      expect((e as BadRequestException).message).toMatch(/name/);
    }
  });
});
```

- [ ] **Step 4.6: Run tests**

```bash
pnpm -F @modeldoctor/contracts type-check
pnpm -F @modeldoctor/api test
```
Expected: both green. Pipe spec shows 3 tests passing.

- [ ] **Step 4.7: Commit**

```bash
git add packages/contracts apps/api/src/common apps/api/src/main.ts
git commit -m "feat(api): add ZodValidationPipe and legacy-shaped AllExceptionsFilter"
```

---

## Task 5: Health module (`/api/health`, `/api/check-vegeta`)

**Files:**
- Create: `packages/contracts/src/health.ts`
- Modify: `packages/contracts/src/index.ts` (add health export)
- Create: `apps/api/src/modules/health/health.module.ts`
- Create: `apps/api/src/modules/health/health.controller.ts`
- Create: `apps/api/src/modules/health/health.service.ts`
- Modify: `apps/api/src/app.module.ts` (register HealthModule)
- Test: `apps/api/test/e2e/health.e2e-spec.ts`

**What these endpoints return** (per legacy `src/routes/health.js`):
- `GET /api/health` → `{ status: "ok", timestamp: "<ISO>" }`
- `GET /api/check-vegeta` → `{ installed: true, message: "Vegeta is installed", path: "<absolute-path>" }` OR `{ installed: false, message: "...", path: null }`

- [ ] **Step 5.1: Write Zod contracts**

Create `packages/contracts/src/health.ts`:
```typescript
import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const CheckVegetaResponseSchema = z.object({
  installed: z.boolean(),
  message: z.string(),
  path: z.string().nullable(),
});
export type CheckVegetaResponse = z.infer<typeof CheckVegetaResponseSchema>;
```

Add to `packages/contracts/src/index.ts`:
```typescript
export * from "./health.js";
```

- [ ] **Step 5.2: Write `HealthService`**

Create `apps/api/src/modules/health/health.service.ts`:
```typescript
import { Injectable } from "@nestjs/common";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { HealthResponse, CheckVegetaResponse } from "@modeldoctor/contracts";

const execP = promisify(exec);

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  async checkVegeta(): Promise<CheckVegetaResponse> {
    try {
      const { stdout } = await execP("which vegeta");
      const path = stdout.trim();
      if (!path) {
        return { installed: false, message: "Vegeta is not installed. Please install it first.", path: null };
      }
      return { installed: true, message: "Vegeta is installed", path };
    } catch {
      return { installed: false, message: "Vegeta is not installed. Please install it first.", path: null };
    }
  }
}
```

- [ ] **Step 5.3: Write `HealthController`**

Create `apps/api/src/modules/health/health.controller.ts`:
```typescript
import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service.js";
import type { HealthResponse, CheckVegetaResponse } from "@modeldoctor/contracts";

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  getHealth(): HealthResponse {
    return this.health.getHealth();
  }

  @Get("check-vegeta")
  checkVegeta(): Promise<CheckVegetaResponse> {
    return this.health.checkVegeta();
  }
}
```

- [ ] **Step 5.4: Write `HealthModule`**

Create `apps/api/src/modules/health/health.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
```

- [ ] **Step 5.5: Register in `AppModule`**

Edit `apps/api/src/app.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";

@Module({
  imports: [HealthModule],
  controllers: [],   // drop AppController (deleted in Task 10)
  providers: [],     // drop AppService
})
export class AppModule {}
```
(If this breaks the scaffold's default `app.controller.spec.ts`, delete it — Task 10 does this explicitly; doing it now is fine.)

- [ ] **Step 5.6: Write e2e test**

Create `apps/api/test/e2e/health.e2e-spec.ts`:
```typescript
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { HealthResponseSchema, CheckVegetaResponseSchema } from "@modeldoctor/contracts";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health → 200 with legacy-compatible shape", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);
    const parsed = HealthResponseSchema.parse(res.body);
    expect(parsed.status).toBe("ok");
    expect(new Date(parsed.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("GET /api/check-vegeta → 200 with legacy-compatible shape", async () => {
    const res = await request(app.getHttpServer()).get("/api/check-vegeta").expect(200);
    const parsed = CheckVegetaResponseSchema.parse(res.body);
    expect(typeof parsed.installed).toBe("boolean");
    if (parsed.installed) {
      expect(parsed.path).toMatch(/\S/);
    } else {
      expect(parsed.path).toBeNull();
    }
  });
});
```

- [ ] **Step 5.7: Run e2e**

```bash
pnpm -F @modeldoctor/api test:e2e
```
Expected: 2 tests passing. If `check-vegeta` fails because vegeta isn't installed, the test handles both branches — it should still pass.

- [ ] **Step 5.8: Manual dev smoke**

```bash
pnpm dev &  # or in another terminal
sleep 5
curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/api/check-vegeta
pkill -f "nest start"; pkill -f "vite"
```
Both should return JSON.

- [ ] **Step 5.9: Commit**

```bash
git add packages/contracts apps/api/src/modules/health apps/api/src/app.module.ts apps/api/test
git commit -m "feat(api): implement /api/health and /api/check-vegeta (HealthModule)"
```

---

## Task 6: Debug-proxy module (`POST /api/debug/proxy`)

**Files:**
- Create: `packages/contracts/src/debug-proxy.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/modules/debug-proxy/debug-proxy.module.ts`
- Create: `apps/api/src/modules/debug-proxy/debug-proxy.controller.ts`
- Create: `apps/api/src/modules/debug-proxy/debug-proxy.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/e2e/debug-proxy.e2e-spec.ts`

**Scope:** port the legacy `src/routes/debug-proxy.js` behaviour. Read `git show 877ba8f~1:src/routes/debug-proxy.js` first. Key rules:
- Request: `{ method?: "GET" | ..., url: string, headers?: Record<string,string>, body?: string | null, timeoutMs?: number }`. `url` required.
- Fetches upstream via native `fetch` + `AbortController` with a 60s default timeout.
- If response body > 20 MB → returns `{ success: false, error: "Response body exceeds ..." }` (legacy uses 200 OK for this; confirm).
- Content-Type starting with `image/`, `audio/`, `video/`, or `application/octet-stream` → base64-encode body, set `bodyEncoding: "base64"`.
- Otherwise → UTF-8 text body, set `bodyEncoding: "text"`.
- Timing: `ttfbMs` from start to first byte, `totalMs` from start to final byte.
- Headers returned as `Record<string, string>` (last-write-wins).

- [ ] **Step 6.1: Write Zod contracts**

Create `packages/contracts/src/debug-proxy.ts`:
```typescript
import { z } from "zod";

export const DebugProxyRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]).default("GET"),
  url: z.string().min(1, "url is required"),
  headers: z.record(z.string()).default({}),
  body: z.union([z.string(), z.null()]).optional(),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
});
export type DebugProxyRequest = z.infer<typeof DebugProxyRequestSchema>;

export const DebugProxyResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    status: z.number().int(),
    statusText: z.string(),
    headers: z.record(z.string()),
    body: z.string(),
    bodyEncoding: z.enum(["text", "base64"]),
    timingMs: z.object({ ttfbMs: z.number(), totalMs: z.number() }),
    sizeBytes: z.number().int().nonnegative(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);
export type DebugProxyResponse = z.infer<typeof DebugProxyResponseSchema>;
```

Add to `packages/contracts/src/index.ts`:
```typescript
export * from "./debug-proxy.js";
```

- [ ] **Step 6.2: Write `DebugProxyService`**

Create `apps/api/src/modules/debug-proxy/debug-proxy.service.ts`:
```typescript
import { Injectable } from "@nestjs/common";
import type { DebugProxyRequest, DebugProxyResponse } from "@modeldoctor/contracts";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

function looksBinary(contentType: string): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith("image/") ||
    contentType.startsWith("audio/") ||
    contentType.startsWith("video/") ||
    contentType === "application/octet-stream"
  );
}

@Injectable()
export class DebugProxyService {
  async forward(req: DebugProxyRequest): Promise<DebugProxyResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    const startedAt = Date.now();
    let ttfbAt: number | null = null;

    try {
      const init: RequestInit = {
        method: req.method,
        headers: req.headers,
        signal: controller.signal,
      };
      if (req.body !== null && req.body !== undefined && req.method !== "GET" && req.method !== "HEAD") {
        init.body = req.body;
      }
      const response = await fetch(req.url, init);
      ttfbAt = Date.now();

      const contentType = response.headers.get("content-type") ?? "";
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_BODY_BYTES) {
        return { success: false, error: `Response body exceeds ${MAX_BODY_BYTES} bytes` };
      }

      const binary = looksBinary(contentType);
      const body = binary ? buffer.toString("base64") : buffer.toString("utf-8");
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers,
        body,
        bodyEncoding: binary ? "base64" : "text",
        timingMs: { ttfbMs: ttfbAt - startedAt, totalMs: Date.now() - startedAt },
        sizeBytes: buffer.byteLength,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Request timeout / aborted"
          : err instanceof Error
            ? err.message
            : String(err);
      return { success: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 6.3: Write `DebugProxyController`**

Create `apps/api/src/modules/debug-proxy/debug-proxy.controller.ts`:
```typescript
import { Body, Controller, Post, UsePipes } from "@nestjs/common";
import { DebugProxyService } from "./debug-proxy.service.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  DebugProxyRequestSchema,
  type DebugProxyRequest,
  type DebugProxyResponse,
} from "@modeldoctor/contracts";

@Controller("debug")
export class DebugProxyController {
  constructor(private readonly proxy: DebugProxyService) {}

  @Post("proxy")
  @UsePipes(new ZodValidationPipe(DebugProxyRequestSchema))
  forward(@Body() body: DebugProxyRequest): Promise<DebugProxyResponse> {
    return this.proxy.forward(body);
  }
}
```

- [ ] **Step 6.4: Write `DebugProxyModule` and register it**

Create `apps/api/src/modules/debug-proxy/debug-proxy.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { DebugProxyController } from "./debug-proxy.controller.js";
import { DebugProxyService } from "./debug-proxy.service.js";

@Module({
  controllers: [DebugProxyController],
  providers: [DebugProxyService],
})
export class DebugProxyModule {}
```

Edit `apps/api/src/app.module.ts` to add `DebugProxyModule` to `imports`.

- [ ] **Step 6.5: Write e2e test with an in-memory upstream**

Create `apps/api/test/e2e/debug-proxy.e2e-spec.ts`:
```typescript
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";

describe("DebugProxy (e2e)", () => {
  let app: INestApplication;
  let upstream: http.Server;
  let upstreamUrl: string;

  beforeAll(async () => {
    // In-memory upstream that echoes request method + headers + body.
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url === "/text") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("hello from upstream");
          return;
        }
        if (req.url === "/image") {
          res.setHeader("Content-Type", "image/png");
          res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
          return;
        }
        if (req.url === "/echo-method") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString() }));
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const addr = upstream.address() as AddressInfo;
    upstreamUrl = `http://127.0.0.1:${addr.port}`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it("rejects missing url with 400 and legacy error shape", async () => {
    const res = await request(app.getHttpServer()).post("/api/debug/proxy").send({}).expect(400);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining("url") });
  });

  it("forwards GET and returns decoded text body", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/text` })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bodyEncoding).toBe("text");
    expect(res.body.body).toBe("hello from upstream");
    expect(res.body.status).toBe(200);
    expect(typeof res.body.timingMs.totalMs).toBe("number");
  });

  it("base64-encodes binary responses", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/image` })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bodyEncoding).toBe("base64");
    // PNG signature base64 prefix is "iVBOR"; our 8-byte stub decodes to that.
    expect(Buffer.from(res.body.body, "base64")[0]).toBe(0x89);
  });

  it("forwards POST body", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({
        method: "POST",
        url: `${upstreamUrl}/echo-method`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      })
      .expect(200);
    const echo = JSON.parse(res.body.body);
    expect(echo.method).toBe("POST");
    expect(JSON.parse(echo.body)).toEqual({ hello: "world" });
  });

  it("returns success:false with timeout message on abort", async () => {
    // Point at a non-routable IP with tiny timeout; fetch will abort.
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({ method: "GET", url: "http://10.255.255.1", timeoutMs: 100 })
      .expect(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/timeout|aborted|fetch/i);
  });
});
```

- [ ] **Step 6.6: Run e2e**

```bash
pnpm -F @modeldoctor/api test:e2e
```
Expected: previous health tests + 5 new debug-proxy tests all pass.

- [ ] **Step 6.7: Commit**

```bash
git add packages/contracts apps/api/src/modules/debug-proxy apps/api/src/app.module.ts apps/api/test
git commit -m "feat(api): implement POST /api/debug/proxy (DebugProxyModule)"
```

---

## Task 7: E2E-test module (`POST /api/e2e-test`)

**Files:**
- Create: `packages/contracts/src/e2e-test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/modules/e2e-test/e2e-test.module.ts`
- Create: `apps/api/src/modules/e2e-test/e2e-test.controller.ts`
- Create: `apps/api/src/modules/e2e-test/e2e-test.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/e2e/e2e-test.e2e-spec.ts`

**Scope:** port `src/routes/e2e-test.js`. Accepts `{ apiUrl, apiKey, model, customHeaders?, probes: [...] }`, dispatches to the probes in `apps/api/src/integrations/probes/`, runs them in parallel, returns `{ success, results: [...] }`. Success path calls upstream model APIs — **e2e tests only cover validation-error paths**; happy path is manual.

- [ ] **Step 7.1: Write Zod contracts**

Create `packages/contracts/src/e2e-test.ts`:
```typescript
import { z } from "zod";

export const ProbeNameSchema = z.enum(["text", "image", "audio"]);
export type ProbeName = z.infer<typeof ProbeNameSchema>;

export const ProbeCheckSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  info: z.string().optional(),
});
export type ProbeCheck = z.infer<typeof ProbeCheckSchema>;

export const ProbeResultSchema = z.object({
  pass: z.boolean(),
  latencyMs: z.number().nullable(),
  checks: z.array(ProbeCheckSchema),
  details: z.object({
    content: z.string().optional(),
    usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
    imagePreviewB64: z.string().optional(),
    imageMime: z.string().optional(),
    audioB64: z.string().optional(),
    audioBytes: z.number().optional(),
    numChoices: z.number().optional(),
    textReply: z.string().optional(),
    error: z.string().optional(),
  }),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export const E2ETestRequestSchema = z.object({
  apiUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  probes: z.array(ProbeNameSchema).min(1),
});
export type E2ETestRequest = z.infer<typeof E2ETestRequestSchema>;

export const E2ETestResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(ProbeResultSchema.extend({ probe: ProbeNameSchema })),
  error: z.string().optional(),
});
export type E2ETestResponse = z.infer<typeof E2ETestResponseSchema>;
```

Add to `packages/contracts/src/index.ts`:
```typescript
export * from "./e2e-test.js";
```

**Note:** the legacy `{ success: false, error: "..." }` for missing params collapses into Task 4's AllExceptionsFilter (400 from pipe → shape is automatic). The legacy `{ success: true, allPassed: boolean, results }` returns had `allPassed`; FE doesn't read it (FE type excludes it). Drop it from the new contract — simpler. If the reviewer asks to keep it, add it.

- [ ] **Step 7.2: Write `E2ETestService`**

Create `apps/api/src/modules/e2e-test/e2e-test.service.ts`:
```typescript
import { Injectable } from "@nestjs/common";
import type { E2ETestRequest, E2ETestResponse } from "@modeldoctor/contracts";
import { PROBES, type ProbeCtx, type ProbeName } from "../../integrations/probes/index.js";

function parseHeaderLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes(":")) continue;
    const idx = rawLine.indexOf(":");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

@Injectable()
export class E2ETestService {
  async run(req: E2ETestRequest): Promise<E2ETestResponse> {
    const extraHeaders = parseHeaderLines(req.customHeaders);
    const ctx: ProbeCtx = { apiUrl: req.apiUrl, apiKey: req.apiKey, model: req.model, extraHeaders };

    const results = await Promise.all(
      req.probes.map(async (name: ProbeName) => {
        try {
          const r = await PROBES[name](ctx);
          return { probe: name, ...r };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            probe: name,
            pass: false,
            latencyMs: null,
            checks: [{ name: "probe execution", pass: false, info: msg }],
            details: { error: msg },
          };
        }
      }),
    );

    return { success: true, results };
  }
}
```

- [ ] **Step 7.3: Write `E2ETestController`**

Create `apps/api/src/modules/e2e-test/e2e-test.controller.ts`:
```typescript
import { Body, Controller, Post, UsePipes } from "@nestjs/common";
import { E2ETestService } from "./e2e-test.service.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  E2ETestRequestSchema,
  type E2ETestRequest,
  type E2ETestResponse,
} from "@modeldoctor/contracts";

@Controller()
export class E2ETestController {
  constructor(private readonly svc: E2ETestService) {}

  @Post("e2e-test")
  @UsePipes(new ZodValidationPipe(E2ETestRequestSchema))
  run(@Body() body: E2ETestRequest): Promise<E2ETestResponse> {
    return this.svc.run(body);
  }
}
```

- [ ] **Step 7.4: Write `E2ETestModule`, register it**

Standard module file + add to `AppModule.imports`.

- [ ] **Step 7.5: Write e2e test (validation errors only)**

Create `apps/api/test/e2e/e2e-test.e2e-spec.ts`:
```typescript
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";

describe("E2ETest (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects missing apiUrl", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/e2e-test")
      .send({ apiKey: "k", model: "m", probes: ["text"] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/apiUrl/);
  });

  it("rejects empty probes array", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/e2e-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", probes: [] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/probes/);
  });

  it("rejects unknown probe name", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/e2e-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", probes: ["bogus"] })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/probes/);
  });
});
```

- [ ] **Step 7.6: Run e2e**

```bash
pnpm -F @modeldoctor/api test:e2e
```
All prior + 3 new tests passing.

- [ ] **Step 7.7: Commit**

```bash
git add packages/contracts apps/api/src/modules/e2e-test apps/api/src/app.module.ts apps/api/test
git commit -m "feat(api): implement POST /api/e2e-test (E2ETestModule)"
```

---

## Task 8: Load-test module (`POST /api/load-test`)

**Files:**
- Create: `packages/contracts/src/load-test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/modules/load-test/load-test.module.ts`
- Create: `apps/api/src/modules/load-test/load-test.controller.ts`
- Create: `apps/api/src/modules/load-test/load-test.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/e2e/load-test.e2e-spec.ts`

**Scope:** port `src/routes/load-test.js`. This is the most complex endpoint. It:
1. Validates rate (1–10000) and duration (1–3600).
2. Builds the upstream request body via `buildRequestBody` (from integrations).
3. Writes `tmp/request.json` and `tmp/request.txt` (Vegeta's attack file format).
4. `exec`s `cat <txt> | vegeta attack -rate=N -duration=Ms | vegeta report` with `timeout = (duration + 60)s`.
5. Parses the report via `parseVegetaReport`.
6. Returns `{ success, report, parsed, config }`.

**Happy-path e2e requires vegeta installed on the runner — skip that here. e2e covers validation-error paths.**

- [ ] **Step 8.1: Write Zod contracts**

Create `packages/contracts/src/load-test.ts`:
```typescript
import { z } from "zod";

export const ApiTypeSchema = z.enum([
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
]);
export type ApiType = z.infer<typeof ApiTypeSchema>;

export const LoadTestRequestSchema = z.object({
  apiType: ApiTypeSchema.optional(),
  apiUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  rate: z.coerce.number().int().min(1).max(10_000),
  duration: z.coerce.number().int().min(1).max(3_600),
  // The rest of fields per-apiType (prompt, maxTokens, etc.) pass through — don't validate here.
}).passthrough();
export type LoadTestRequest = z.infer<typeof LoadTestRequestSchema>;

export const LoadTestParsedSchema = z.object({
  requests: z.number().nullable(),
  success: z.number().nullable(),
  throughput: z.number().nullable(),
  latencies: z.object({
    mean: z.string().nullable(),
    p50: z.string().nullable(),
    p95: z.string().nullable(),
    p99: z.string().nullable(),
    max: z.string().nullable(),
  }),
});
export type LoadTestParsed = z.infer<typeof LoadTestParsedSchema>;

export const LoadTestResponseSchema = z.object({
  success: z.literal(true),
  report: z.string(),
  parsed: LoadTestParsedSchema,
  config: z.object({
    apiType: ApiTypeSchema,
    apiUrl: z.string(),
    model: z.string(),
    rate: z.number(),
    duration: z.number(),
  }),
});
export type LoadTestResponse = z.infer<typeof LoadTestResponseSchema>;
```

Add to `packages/contracts/src/index.ts`.

- [ ] **Step 8.2: Write `LoadTestService`**

Create `apps/api/src/modules/load-test/load-test.service.ts`. Read `git show 877ba8f~1:src/routes/load-test.js` for the exact behaviour. Key points to preserve:

```typescript
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LoadTestRequest, LoadTestResponse } from "@modeldoctor/contracts";
import { buildRequestBody, VALID_API_TYPES, type ApiType } from "../../integrations/builders/index.js";
import { parseVegetaReport } from "../../integrations/parsers/vegeta-report.js";

const TMP_DIR = path.resolve(process.cwd(), "tmp");

@Injectable()
export class LoadTestService {
  async run(req: LoadTestRequest): Promise<LoadTestResponse> {
    const apiType = (VALID_API_TYPES as readonly string[]).includes(req.apiType ?? "")
      ? (req.apiType as ApiType)
      : "chat";

    let requestBody: Record<string, unknown>;
    try {
      requestBody = buildRequestBody(apiType, { model: req.model, ...req });
    } catch (e) {
      throw new InternalServerErrorException(e instanceof Error ? e.message : String(e));
    }

    await fs.mkdir(TMP_DIR, { recursive: true });
    const jsonPath = path.join(TMP_DIR, "request.json");
    const txtPath = path.join(TMP_DIR, "request.txt");
    await fs.writeFile(jsonPath, JSON.stringify(requestBody, null, 2));

    // Build target URL including query params
    let finalUrl = req.apiUrl;
    if (req.queryParams && req.queryParams.trim()) {
      const params = req.queryParams
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p.includes("="));
      if (params.length > 0) {
        const sep = finalUrl.includes("?") ? "&" : "?";
        finalUrl = finalUrl + sep + params.join("&");
      }
    }

    // Custom headers
    let extraHeaders = "";
    if (req.customHeaders && req.customHeaders.trim()) {
      const lines = req.customHeaders
        .split("\n")
        .map((h) => h.trim())
        .filter((h) => h.length > 0 && h.includes(":"));
      extraHeaders = lines.map((h) => `\n${h}`).join("");
    }

    const txt = `POST ${finalUrl}
Content-Type: application/json
Authorization: Bearer ${req.apiKey}${extraHeaders}
@${jsonPath}`;
    await fs.writeFile(txtPath, txt);

    // Spawn vegeta via a shell pipe. Use spawn with shell:true so we can pipe attack→report.
    const cmd = `cat ${txtPath} | vegeta attack -rate=${req.rate} -duration=${req.duration}s | vegeta report`;
    const timeoutMs = (req.duration + 60) * 1000;

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, {
        cwd: TMP_DIR,
        shell: true,
        timeout: timeoutMs,
      });
      let out = "";
      let err = "";
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
      child.on("close", (code: number | null) => {
        if (code === 0) resolve(out);
        else reject(new Error(`vegeta exited ${code}: ${err || out}`));
      });
      child.on("error", (e: Error) => reject(e));
    });

    const parsed = parseVegetaReport(stdout);
    return {
      success: true,
      report: stdout,
      parsed,
      config: {
        apiType,
        apiUrl: finalUrl,
        model: req.model,
        rate: req.rate,
        duration: req.duration,
      },
    };
  }
}
```

- [ ] **Step 8.3: Write `LoadTestController`**

```typescript
import { Body, Controller, Post, UsePipes } from "@nestjs/common";
import { LoadTestService } from "./load-test.service.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  LoadTestRequestSchema,
  type LoadTestRequest,
  type LoadTestResponse,
} from "@modeldoctor/contracts";

@Controller()
export class LoadTestController {
  constructor(private readonly svc: LoadTestService) {}

  @Post("load-test")
  @UsePipes(new ZodValidationPipe(LoadTestRequestSchema))
  run(@Body() body: LoadTestRequest): Promise<LoadTestResponse> {
    return this.svc.run(body);
  }
}
```

- [ ] **Step 8.4: Write `LoadTestModule`, register it**

Standard + `AppModule.imports`.

- [ ] **Step 8.5: Write e2e test (validation errors only)**

Create `apps/api/test/e2e/load-test.e2e-spec.ts`:
```typescript
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";

describe("LoadTest (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects missing apiUrl", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .send({ apiKey: "k", model: "m", rate: 1, duration: 1 })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects rate=0", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 0, duration: 1 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/rate/i);
  });

  it("rejects duration>3600", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/load-test")
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 1, duration: 99999 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/duration/i);
  });
});
```

- [ ] **Step 8.6: Run tests**

```bash
pnpm -F @modeldoctor/api test:e2e
```
All prior + 3 new tests pass.

- [ ] **Step 8.7: Commit**

```bash
git add packages/contracts apps/api/src/modules/load-test apps/api/src/app.module.ts apps/api/test
git commit -m "feat(api): implement POST /api/load-test (LoadTestModule)"
```

---

## Task 9: Remove Nest default scaffold

**Files:**
- Delete: `apps/api/src/app.controller.ts`
- Delete: `apps/api/src/app.service.ts`
- Delete: `apps/api/src/app.controller.spec.ts` (the Phase 0 Vitest smoke — no longer needed)
- Modify: `apps/api/src/app.module.ts` (already trimmed through earlier tasks; verify)

- [ ] **Step 9.1: Delete scaffold files**

```bash
rm apps/api/src/app.controller.ts apps/api/src/app.service.ts apps/api/src/app.controller.spec.ts
```

- [ ] **Step 9.2: Verify `app.module.ts` has no stale imports**

Expected contents:
```typescript
import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { DebugProxyModule } from "./modules/debug-proxy/debug-proxy.module.js";
import { E2ETestModule } from "./modules/e2e-test/e2e-test.module.js";
import { LoadTestModule } from "./modules/load-test/load-test.module.js";

@Module({
  imports: [HealthModule, DebugProxyModule, E2ETestModule, LoadTestModule],
})
export class AppModule {}
```
No `controllers: [AppController]`, no `providers: [AppService]`.

- [ ] **Step 9.3: Run full test suite + type-check**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api test:e2e
```
All green. (`test` will have fewer tests now since `app.controller.spec.ts` is gone.)

- [ ] **Step 9.4: Dev smoke — confirm `GET /api` now 404s (no more Hello World)**

```bash
pnpm dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api           # 404 expected
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health    # 200 expected
pkill -f "nest start"; pkill -f "vite"
```
This confirms we've retired the placeholder and the real endpoints are live.

- [ ] **Step 9.5: Commit**

```bash
git add apps/api/src
git commit -m "chore(api): remove Nest default scaffold (AppController/AppService/spec)"
```

---

## Task 10: FE smoke + pull Zod types into the FE

**Files:**
- Modify: `apps/web/src/features/e2e-smoke/types.ts` (re-export from contracts OR delete and import directly; pick one)
- Modify: `apps/web/src/features/load-test/types.ts` (same)
- Modify: `apps/web/src/features/request-debug/types.ts` (same)
- Optionally: `apps/web/src/lib/api-client.ts` or the FE store files if they want to `parse` responses

Keep this task **narrow**: the FE currently has hand-written types that match the backend's Zod schemas. Replace the hand-written types with re-exports from `@modeldoctor/contracts` so there's one source of truth. Do NOT change component behaviour.

- [ ] **Step 10.1: Replace `apps/web/src/features/e2e-smoke/types.ts`**

```typescript
export type {
  ProbeName,
  ProbeCheck,
  ProbeResult,
  E2ETestResponse,
} from "@modeldoctor/contracts";
```

- [ ] **Step 10.2: Replace `apps/web/src/features/load-test/types.ts`**

```typescript
export { API_TYPES } from "./api-types.js"; // if needed — check usage; else:
export type {
  ApiType,
  LoadTestParsed,
  LoadTestResponse,
} from "@modeldoctor/contracts";

// FE-only aggregate type, if the UI uses it:
import type { LoadTestResponse } from "@modeldoctor/contracts";
export type LoadTestResult = Omit<LoadTestResponse, "success">;
```
(`API_TYPES` is a runtime const that FE uses for a dropdown — check usage. If FE reads it, keep it here; otherwise import `ApiTypeSchema.options` from contracts.)

- [ ] **Step 10.3: Replace `apps/web/src/features/request-debug/types.ts`**

```typescript
export type { DebugProxyResponse } from "@modeldoctor/contracts";

// FE-only UI types stay here
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
export interface KeyValueRow { key: string; value: string; enabled: boolean; }

// Alias for the success-branch of the wire type, named to match existing FE code:
import type { DebugProxyResponse } from "@modeldoctor/contracts";
export type DebugResponse = Extract<DebugProxyResponse, { success: true }>;
```

- [ ] **Step 10.4: `pnpm -r type-check`**

Expected: green. If any FE file breaks because a field name changed (e.g. `allPassed` which we dropped), fix by removing references. FE currently doesn't reference `allPassed` (it's not in the original type) so this should be clean.

- [ ] **Step 10.5: `pnpm -r test`**

Expected: green. 62 web tests + api unit tests + api e2e.

- [ ] **Step 10.6: Manual FE smoke — the whole point of Phase 1**

```bash
pnpm dev
```
Open `http://localhost:5173`. Exercise:
- **Load Test tab**: pick a fake endpoint (or a real vLLM/OpenAI if you have one), click Run. If no vegeta installed → 500 from `/api/load-test` with a usable error; if vegeta installed but no upstream → vegeta-reported failures in the report text. The FE should display the response (not show a generic "Not Found").
- **E2E Smoke tab**: enter a real endpoint, click a probe. Should either succeed (if upstream is reachable) or show a probe-level failure (not a network-level "Not Found").
- **Request Debug tab**: paste a valid curl to e.g. `https://httpbin.org/get`, click Send. Should return a `DebugResponse` with timing and body.

Kill `pnpm dev`.

- [ ] **Step 10.7: Commit**

```bash
git add apps/web/src/features
git commit -m "refactor(web): source e2e-smoke/load-test/request-debug types from @modeldoctor/contracts"
```

---

## Task 11: Final DoD, push, open PR

- [ ] **Step 11.1: Clean reinstall + full suite**

```bash
rm -rf node_modules apps/web/node_modules apps/api/node_modules packages/contracts/node_modules
pnpm install
pnpm -r type-check
pnpm -r test
pnpm -F @modeldoctor/api test:e2e
pnpm build
```
All green. `apps/api/dist/main.js` exists and is runnable (`node apps/api/dist/main.js` responds 200 on `/api/health`).

- [ ] **Step 11.2: Push branch**

```bash
git push -u origin feat/nestjs-phase-1
```

- [ ] **Step 11.3: Open PR**

```bash
gh pr create --base main --head feat/nestjs-phase-1 --title "Phase 1: implement 4 HTTP endpoints in apps/api" --body "$(cat <<'EOF'
## Summary

Phase 1 of the NestJS backend refactor (spec: docs/superpowers/specs/2026-04-22-nestjs-backend-refactor-design.md §5 Phase 1, plan: docs/superpowers/plans/2026-04-22-nestjs-refactor-phase-1-route-port.md).

Implements the 4 HTTP endpoints that the FE has been 404'ing on since Phase 0:

- GET /api/health, GET /api/check-vegeta  (HealthModule)
- POST /api/debug/proxy  (DebugProxyModule)
- POST /api/e2e-test  (E2ETestModule)
- POST /api/load-test  (LoadTestModule)

Plus shared infrastructure:
- Zod schemas in packages/contracts/src/ (health, debug-proxy, e2e-test, load-test, errors)
- ZodValidationPipe (per-endpoint) + AllExceptionsFilter (global, legacy-shaped errors)
- Pure-function integrations layer (builders, parsers, probes, utils) restored from git history and translated to strict TS
- FE type files re-export from @modeldoctor/contracts — one source of truth for wire formats

## Parity with legacy Express

The deleted Express backend (commit 877ba8f~1) was not fixture-captured per spec §2.3 — explicit user decision at Phase 0 closeout. Parity is verified via:
- Zod schemas mirroring the FE types (which defined the contract)
- e2e tests for every validation-error path (deterministic)
- Manual FE smoke across all three implemented tabs

## Test plan

- [x] pnpm -r type-check across web/api/contracts
- [x] pnpm -r test (unit + vitest smoke)
- [x] pnpm -F @modeldoctor/api test:e2e (health, debug-proxy, e2e-test, load-test validation paths)
- [x] pnpm build produces runnable apps/api/dist/main.js
- [ ] Manual FE smoke by reviewer: Load Test, E2E Smoke, Request Debug tabs all talk to the real backend (not 404)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 11.4: Report PR URL**

Done.

---

## Phase 1 Definition of Done Checklist

- [ ] All 4 endpoints respond (no more 404):
  - `GET /api/health` → 200
  - `GET /api/check-vegeta` → 200
  - `POST /api/e2e-test` → 400 on missing params, 200 on valid (happy path manual)
  - `POST /api/load-test` → 400 on bad rate/duration, 200 + vegeta report on valid
  - `POST /api/debug/proxy` → 400 on missing url, 200 on valid
- [ ] Error responses follow legacy shape: `{ success: false, error: string }`
- [ ] `packages/contracts/src/` has schemas for all 4 endpoints + errors + common
- [ ] FE `features/*/types.ts` re-export from `@modeldoctor/contracts`
- [ ] `pnpm -r type-check` green
- [ ] `pnpm -r test` green
- [ ] `pnpm test:e2e` green
- [ ] `pnpm build && node apps/api/dist/main.js` boots and responds on all 4 paths
- [ ] Nest default scaffold (`app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`) deleted
- [ ] Integrations layer (builders, parsers, probes, utils, assets) under `apps/api/src/integrations/` — no legacy `src/` at repo root
- [ ] Manual FE smoke: all 3 implemented tabs exercise real backend successfully (given reachable upstream model APIs)

---

## Out of Scope (Phase 2+)

- `@nestjs/config` env validation
- `nestjs-pino` structured logging + requestId
- `@nestjs/swagger` OpenAPI
- Authentication (Passport, JWT)
- Persistence (Prisma, Postgres)
- `ServeStaticModule` for FE serving in prod (still Vite-only right now)
- Unifying vitest version between apps/web (v1) and apps/api (v2)
- Untracking `apps/web/*.tsbuildinfo` (already in `.gitignore` but still in index)

---

**End of Phase 1 plan.**
