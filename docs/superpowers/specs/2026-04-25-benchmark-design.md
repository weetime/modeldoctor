# Model Benchmark — guidellm Runner on K8s

**Status:** Draft — pending user approval
**Date:** 2026-04-25
**Predecessors:**
- Spec 1 (`2026-04-20-modeldoctor-restructure-design.md`) — frontend rewrite to Vite + React + TypeScript.
- Spec 2 (`2026-04-22-nestjs-backend-refactor-design.md`) — NestJS + Prisma + auth + RBAC.

This spec extends Spec 2's NestJS infrastructure with a new `Benchmark` feature module, a Python container image, and a Kubernetes-Job-based execution layer.

## 1. Purpose and Scope

### 1.1 Problem Statement

ModelDoctor today ships **load testing** (Vegeta — pure HTTP) and **end-to-end smoke tests** (correctness). It does not measure **inference-layer performance**: token-level latencies (TTFT, ITL), token throughput, prefill vs decode behavior, or LLM-shaped metrics that buyers, capacity planners, and inference-engine tuners actually care about.

Reference benchmark UX comes from GPUStack (`gpustack/benchmark-runner:v0.0.3`), which is itself a thin wrapper over **guidellm** — Neural Magic / vLLM team's de-facto-standard inference benchmarking CLI. Industry-standard metric definitions, profile semantics, and dataset conventions are guidellm's.

### 1.2 What This Spec Delivers

A new `Benchmark` feature, end-to-end:

- **Domain model**: a single `BenchmarkRun` Prisma entity with full LLM-benchmark metric coverage (TTFT, ITL, output tokens/s, request throughput, success/error counts, percentiles).
- **API surface**: NestJS `BenchmarkModule` with create / list / detail / cancel / delete + an internal HMAC-authenticated callback endpoint for the runner pod to report state and metrics.
- **Execution**: each benchmark run launches a one-shot Kubernetes Job in the same cluster the API runs in. The Job pulls `modeldoctor/benchmark-runner:<tag>`, executes guidellm against the user-supplied OpenAI-compatible endpoint, and POSTs results back to the API.
- **Runner image**: a Python 3.11-slim image at `apps/benchmark-runner/`, ~50-line Python entrypoint that translates env vars into a guidellm CLI invocation and reports lifecycle + metrics back to the API.
- **Driver abstraction**: a `BenchmarkExecutionDriver` interface with one production implementation (`K8sJobDriver`) and a concrete plan to add `SubprocessDriver` later if local-without-K8s dev becomes painful.
- **Web UI**: a `Benchmarks` page mirroring GPUStack's two-tab modal (基本信息 / 配置), a list view with status badges + filters, a detail page with the full metrics table and runtime logs, and 5 named profile presets (Throughput, Latency, Long Context, Generation Heavy, ShareGPT).
- **K8s integration**: ServiceAccount, RBAC (Role + RoleBinding restricted to `batch/v1/jobs` in one namespace), `@kubernetes/client-node` wired into the API.

### 1.3 Explicit Non-Goals

- **No `Cluster` or `ModelInstance` Prisma entities.** GPUStack's benchmark form references a cluster + model-instance because GPUStack itself manages model deployments. ModelDoctor does not. Users supply `apiUrl + apiKey + model` directly, the same way LoadTest accepts them today. The "集群 / 模型实例" fields from the GPUStack screenshot are collapsed into a single endpoint section.
- **No K8s deployment manifests for ModelDoctor itself.** The user already runs ModelDoctor in their 4pd cluster. This spec only ships the manifests *the API needs to create benchmark Jobs* (ServiceAccount + Role + RoleBinding for `batch/v1/jobs`); how the API/web/db pods themselves get deployed is out of scope.
- **No ShareGPT bundled in the runner image.** The `ShareGPT` profile and `dataset=sharegpt` option in the schema are placeholders — the form lets the user pick them, but Phase 1 returns a validation error ("ShareGPT not yet supported"). Backfilled in a follow-up. This keeps the runner image small (~600 MB Python + guidellm vs ~1.2 GB with ShareGPT JSON).
- **No SSE / WebSocket streaming.** Progress is polled by the web UI every 2s on the detail page. Real-time push deferred.
- **No multi-cluster.** API uses in-cluster config and creates Jobs in its own cluster only.
- **No `LoadTestRun` deprecation.** Load test (HTTP-layer) and benchmark (model-layer) coexist permanently. They answer different questions.
- **No GPU access for runner pods.** Runner is a pure HTTP client; it does *not* request `nvidia.com/gpu`. All GPU work happens at the user-supplied target endpoint, which ModelDoctor doesn't manage.
- **No live log streaming from the K8s pod.** stderr/stdout are captured by the runner wrapper, posted back in chunks via the callback API, and stored in the DB. The detail page polls these. Live `kubectl logs -f` style is out of scope.

### 1.4 Background — What Is Being Measured

LLM serving has two distinct phases that affect benchmark design:
- **Prefill**: processing the input prompt; bounded by GPU compute and KV-cache memory; dominates Time-To-First-Token.
- **Decode**: emitting output tokens one at a time; bounded by memory bandwidth; dominates Inter-Token Latency.

Standard metrics:

| Metric | What it measures | Why it matters |
|---|---|---|
| **TTFT** (Time To First Token) | ms from request sent → first token returned | "How long until the answer starts appearing?" |
| **ITL** (Inter-Token Latency) | ms between consecutive output tokens | Streaming "typing speed" |
| **TPOT** (Time Per Output Token) | mean per-token cost across the request | Same idea as ITL, mean form |
| **E2E Latency** | full request duration | Total wait |
| **Requests/sec** | completed requests per wall-clock second | Throughput in service-level units |
| **Output tokens/sec** | output tokens emitted per second | Throughput in model-effort units |
| **Concurrency mean / max** | in-flight request count | How parallel the load actually was |
| **Success / Error / Incomplete** | completion buckets | Reliability under load |

The five profiles each isolate a different concern:

| Profile | Input tokens | Output tokens | Rate | Total req | What it stresses |
|---|---|---|---|---|---|
| **Throughput** | 1024 | 128 | unlimited | 1000 | Peak server capacity, batch behavior |
| **Latency** | 128 | 128 | 1 req/s | 100 | Single-user response speed; SLA |
| **Long Context** | 32 000 | 100 | 1 req/s | 100 | Prefill compute + KV-cache memory; RAG / long-document |
| **Generation Heavy** | 1000 | 2000 | 1 req/s | 200 | Decode speed; code/long-form generation |
| **ShareGPT** | (mixed real data) | (mixed) | (mixed) | 1000 | Realistic mixed traffic |

A throughput-tuned config has bad latency; a latency-tuned config has bad throughput. Long Context tests prefill; Generation Heavy tests decode. Running multiple profiles is the point.

## 2. Architecture

### 2.1 Component Diagram

```
4pd Kubernetes cluster
┌────────────────────────────────────────────────────────────────────┐
│ namespace: modeldoctor                                             │
│                                                                    │
│   ┌────────────────────┐          ┌──────────────────────────┐     │
│   │ modeldoctor-web    │  HTTP    │  modeldoctor-api          │    │
│   │ (Vite SPA in nginx)│ ───────► │  (NestJS)                 │    │
│   └────────────────────┘          │  ┌────────────────────┐  │    │
│                                   │  │ BenchmarkController│  │    │
│                                   │  │ BenchmarkService   │  │    │
│                                   │  │ ┌───────────────┐  │  │    │
│                                   │  │ │ K8sJobDriver  │──┼──┼──┐ │
│                                   │  │ └───────────────┘  │  │  │ │
│                                   │  │ HmacCallbackGuard  │  │  │ │
│                                   │  └────────────────────┘  │  │ │
│                                   │  uses ServiceAccount     │  │ │
│                                   │  modeldoctor-api-sa      │  │ │
│                                   └──────────┬───────────────┘  │ │
│                                              │ Postgres          │ │
│                                              ▼                   │ │
│                                   ┌──────────────────────────┐   │ │
│                                   │ Prisma → modeldoctor DB  │   │ │
│                                   └──────────────────────────┘   │ │
│                                                                  │ │
│ namespace: modeldoctor-benchmarks                                │ │
│   ┌──────────────────────────────────────────────────────────┐   │ │
│   │ Job: benchmark-<runId>     (created by K8sJobDriver) ◄───┼───┘ │
│   │  ┌────────────────────────────────────────────────────┐  │     │
│   │  │ Pod: modeldoctor/benchmark-runner:<tag>           │  │     │
│   │  │  - reads env: TARGET_URL, API_KEY, MODEL,          │  │     │
│   │  │    PROFILE, PROMPT_TOKENS, OUTPUT_TOKENS, RATE,    │  │     │
│   │  │    TOTAL_REQUESTS, CALLBACK_URL, CALLBACK_TOKEN,   │  │     │
│   │  │    BENCHMARK_ID                                    │  │     │
│   │  │  - python /app/runner.py                           │  │     │
│   │  │  - spawns guidellm CLI                             │  │     │
│   │  │  - POSTs progress + final metrics to               │  │     │
│   │  │    http://modeldoctor-api.modeldoctor.svc:3001/    │  │     │
│   │  │      api/internal/benchmarks/<id>/{state,metrics}  │──┼──┐  │
│   │  └─────────────────────┬──────────────────────────────┘  │  │  │
│   │  ttlSecondsAfterFinished: 3600                            │  │  │
│   └────────────────────────┼─────────────────────────────────┘  │  │
│                            │ HTTP (OpenAI compatible)            │  │
│                            ▼                                     │  │
│   ┌─────────────────────────────────────────────────────────┐    │  │
│   │ User-supplied target endpoint                           │    │  │
│   │ vLLM / SGLang / TGI / OpenAI / Anthropic / ...          │    │  │
│   │ (in-cluster Service OR external URL)                    │    │  │
│   └─────────────────────────────────────────────────────────┘    │  │
│                                                                  │  │
│   callback flow ◄─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Trust Boundaries

- **api → K8s API server**: in-cluster ServiceAccount + RBAC. Permission: `create / get / list / watch / delete` on `batch/v1/jobs` and `get / list` on `core/v1/pods` (for failure debugging) restricted to namespace `modeldoctor-benchmarks`. No cluster-wide permissions.
- **runner pod → api**: HMAC token, generated per run, embedded as env var, validated by `HmacCallbackGuard`. Token is a short HMAC-SHA256 of `(benchmark_id, exp)` signed with `BENCHMARK_CALLBACK_SECRET` (env var on the API). TTL = `max_duration + 15 min` slack.
- **runner pod → user target endpoint**: standard HTTP. The user-supplied API key flows from the form → DB (encrypted at rest, see §6) → Job env var → guidellm `--api-key`. Secret never logged.

### 2.3 Why K8s Job, Not Subprocess

The end state is K8s. Building subprocess first would force ~30–40 % of the execution layer to be rewritten when migrating: Job creation API, lifecycle tracking (`pid` → `jobName`), cancellation (`SIGTERM` → `delete job`), result retrieval (file → HTTP callback), error handling (exit code → pod terminated state). The Prisma schema, contracts, controllers, and UI carry over but the interesting surface area churns. Driving the design from K8s Day 1 is cheaper.

For local dev without K8s, a `SubprocessDriver` can be added behind the same interface in a follow-up. Anyone with `kubectl` access to 4pd (the user's setup) can develop directly against it.

## 3. Domain Model

### 3.1 Prisma Schema Addition

```prisma
model BenchmarkRun {
  id           String    @id @default(cuid())
  userId       String?   @map("user_id")

  // Identification
  name         String
  description  String?   @db.Text
  profile      String    @default("custom")        // "throughput" | "latency" | "long_context" | "generation_heavy" | "sharegpt" | "custom"

  // Target
  apiType      String    @map("api_type")          // BenchmarkApiType: "chat" | "completion" — narrower than LoadTest's ApiType
  apiUrl       String    @map("api_url")
  apiKeyCipher String    @map("api_key_cipher")    // AES-GCM ciphertext; see §6
  model        String

  // Workload config
  datasetName        String  @default("random")    @map("dataset_name")  // "random" | "sharegpt"
  datasetInputTokens Int?    @map("dataset_input_tokens")
  datasetOutputTokens Int?   @map("dataset_output_tokens")
  datasetSeed        Int?    @map("dataset_seed")
  requestRate        Int     @default(0)           @map("request_rate")  // 0 = unlimited
  totalRequests      Int     @default(1000)        @map("total_requests")

  // Lifecycle
  state        String    @default("pending")       // "pending" | "submitted" | "running" | "completed" | "failed" | "canceled"
  stateMessage String?   @db.Text                  @map("state_message")
  progress     Float?
  jobName      String?   @map("job_name")          // K8s Job metadata.name; null until submitted

  // Metrics (denormalized for list views; full report in rawMetrics)
  metricsSummary Json?   @map("metrics_summary")
  rawMetrics     Json?   @map("raw_metrics")
  logs           String? @db.Text

  createdAt    DateTime  @default(now())           @map("created_at")
  startedAt    DateTime?                           @map("started_at")
  completedAt  DateTime?                           @map("completed_at")

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([state])
  @@map("benchmark_runs")
}
```

`metricsSummary` shape (also exposed as Zod schema in contracts):

```ts
{
  ttft: { mean: number; p50: number; p95: number; p99: number };       // ms
  itl:  { mean: number; p50: number; p95: number; p99: number };       // ms
  e2eLatency: { mean: number; p50: number; p95: number; p99: number }; // ms
  requestsPerSecond: { mean: number };
  outputTokensPerSecond: { mean: number };
  inputTokensPerSecond: { mean: number };
  totalTokensPerSecond: { mean: number };
  concurrency: { mean: number; max: number };
  requests: { total: number; success: number; error: number; incomplete: number };
}
```

`rawMetrics` is whatever JSON guidellm emits, stored verbatim for forensic / re-analysis use. List-view queries select `metricsSummary` only.

### 3.2 User Scoping

Same pattern as `LoadTestRun`: queries filter by `userId = currentUser.sub` unless `currentUser.roles.includes("admin")`. Anyone can create. Admins see all; users see their own. `delete` requires owner-or-admin.

## 4. API Surface

All routes are under `/api`, JWT-protected, and follow the contracts in `packages/contracts/src/benchmark.ts`. The benchmark domain defines its own `BenchmarkApiTypeSchema = z.enum(["chat", "completion"])` — a strict subset of LoadTest's `ApiTypeSchema`. Embeddings / rerank / image / vision / audio APIs do not have meaningful TTFT/ITL semantics and are not supported.

### 4.1 User-Facing

| Method | Route | Body / Query | Returns |
|---|---|---|---|
| `POST` | `/api/benchmarks` | `CreateBenchmarkRequest` (name, description, profile, target endpoint, dataset config, request rate, total requests) | `BenchmarkRun` (state=`pending`) — Job creation kicks off async |
| `GET` | `/api/benchmarks` | `?limit&cursor&state&profile` | `{ items: BenchmarkRunSummary[], nextCursor }` |
| `GET` | `/api/benchmarks/:id` | — | `BenchmarkRun` (full, including `rawMetrics` and `logs`) |
| `POST` | `/api/benchmarks/:id/cancel` | — | `BenchmarkRun` (state=`canceled` if successful) |
| `DELETE` | `/api/benchmarks/:id` | — | `204` |

Profile presets are **client-side**: when the user picks "Throughput" in the modal, the form auto-fills `datasetInputTokens=1024, datasetOutputTokens=128, requestRate=0, totalRequests=1000`. Server stores whatever the user submitted (with the `profile` label as metadata for filtering). The user can still tweak fields after picking a profile — picking a profile is "load preset", not "lock to preset".

### 4.2 Internal (Runner Callback)

| Method | Route | Auth | Body |
|---|---|---|---|
| `POST` | `/api/internal/benchmarks/:id/state` | HMAC | `{ state: "running"|"completed"|"failed", stateMessage?, progress? }` |
| `POST` | `/api/internal/benchmarks/:id/metrics` | HMAC | `{ metricsSummary, rawMetrics, logs }` |

`HmacCallbackGuard` validates the `Authorization: Bearer <hmac-token>` header against the per-run secret derived as `HMAC_SHA256(BENCHMARK_CALLBACK_SECRET, "${id}.${exp}")`, with a constant-time compare and `exp` check. JWT global guard is bypassed via `@Public()` for these routes (the HMAC is the auth).

### 4.3 Validation

- `profile` must be one of the 5 known presets or `"custom"`.
- For `datasetName=random`: both `datasetInputTokens` and `datasetOutputTokens` required, both ≥ 1.
- For `datasetName=sharegpt`: returns 400 in Phase 1 with `code=BENCHMARK_DATASET_UNSUPPORTED`.
- `requestRate` ≥ 0 (0 = unlimited).
- `totalRequests` between 1 and 100 000.
- `apiUrl` must be a valid URL; `model` non-empty; `apiKey` non-empty.
- `name` 1–128 chars, unique per user (soft enforced at controller — DB `@@unique([userId, name])` is too strict for re-runs; we only block within active state in service).

## 5. Runner Image

### 5.1 Layout

```
apps/benchmark-runner/
├── Dockerfile
├── pyproject.toml          # guidellm pin, requests, pydantic
├── runner.py               # entrypoint
└── tests/
    └── test_runner.py      # unit tests, mocks guidellm subprocess and callback HTTP
```

### 5.2 `runner.py` Behavior

```
1. Read env: BENCHMARK_ID, CALLBACK_URL, CALLBACK_TOKEN,
             TARGET_URL, API_KEY, MODEL, API_TYPE,
             DATASET_NAME, PROMPT_TOKENS, OUTPUT_TOKENS, SEED,
             REQUEST_RATE, TOTAL_REQUESTS, MAX_DURATION_SECONDS
2. POST {state: "running"} to CALLBACK_URL/state
3. Build guidellm CLI:
   - If $REQUEST_RATE > 0: --rate-type=constant --rate=$REQUEST_RATE
   - If $REQUEST_RATE == 0: --rate-type=throughput  (guidellm pushes as fast as possible; --rate omitted)

   guidellm benchmark \
     --target $TARGET_URL \
     --model $MODEL \
     <rate flags as above> \
     --max-requests $TOTAL_REQUESTS \
     --max-seconds $MAX_DURATION_SECONDS \
     --data prompt_tokens=$PROMPT_TOKENS,output_tokens=$OUTPUT_TOKENS \
     --output-path /tmp/report.json
4. Spawn guidellm subprocess; tee stdout/stderr to memory buffer.
5. Wait for exit. On non-zero exit:
   - POST {state: "failed", stateMessage: "<last 1024 chars of stderr>"}
   - POST /metrics with empty summary + logs
   - exit 1
6. Parse /tmp/report.json → metricsSummary (mapping in §5.3).
7. POST /metrics with metricsSummary + rawMetrics + logs.
8. POST {state: "completed", progress: 1.0}
9. exit 0
```

### 5.3 guidellm JSON → metricsSummary Mapping

guidellm's output schema (per its 0.4.x docs) provides:
- `time_to_first_token_ms` (mean / median / p95 / p99) → `ttft.{mean,p50,p95,p99}`
- `inter_token_latency_ms` → `itl.*`
- `request_latency_ms` → `e2eLatency.*`
- `requests_per_second` → `requestsPerSecond.mean`
- `output_tokens_per_second`, `prompt_tokens_per_second`, `tokens_per_second` → respective fields
- `request_concurrency.{mean,max}` → `concurrency.{mean,max}`
- `summary.{requests, errors, incomplete}` → `requests.*`

If guidellm releases a breaking schema change, the runner image is the only place to fix it (the API stores `rawMetrics` verbatim and reads only `metricsSummary`).

### 5.4 Image Build

- Base: `python:3.11-slim`
- `pip install guidellm` (pin a specific version, e.g. `0.4.x`).
- `COPY runner.py /app/runner.py`
- `ENTRYPOINT ["python", "/app/runner.py"]`
- Built by CI when `apps/benchmark-runner/**` changes. Tagged `modeldoctor/benchmark-runner:<git-sha>` and `:latest`.

## 6. Security

- **API key encryption**: stored as `apiKeyCipher` (AES-256-GCM, key from `BENCHMARK_API_KEY_ENCRYPTION_KEY` env var, 32 bytes base64). Never returned in any API response (controller-level filter). Decrypted only when materializing the K8s Job env. Added as a Secret on the Job pod (not as plain env in the Job manifest text).
- **HMAC callback**: §2.2 / §4.2.
- **Network policy** (out of MVP scope but documented): runner pods need egress to (a) the API service (callback), (b) the user-supplied target URL. Cluster-default-deny + targeted egress is recommended but not enforced by this spec.
- **Resource quotas**: each Job sets `cpu: 500m, memory: 512Mi` requests and `cpu: 2, memory: 2Gi` limits. Configurable via API env vars `BENCHMARK_RUNNER_CPU_*`, `BENCHMARK_RUNNER_MEMORY_*`.
- **Job TTL**: `ttlSecondsAfterFinished: 3600` so K8s GCs completed Jobs after 1 hour. Logs and metrics are already in our DB.

## 7. State Machine and Reconciliation

```
       create                          first runner callback
pending ─────────► submitted ─────────────────────────────► running
   │                  │                                       │
   │                  │ Job creation API call fails           │ runner POSTs state=completed
   │                  ▼                                       ▼
   └──────────► failed                                    completed
                                                              │
       cancel (any time)                                       │
   ────────────────────────────────► canceled                  │
                                                              │
       reconciler: running > max_duration       ──────────► failed
       reconciler: pod terminated nonzero       ──────────► failed
       reconciler: Job missing & not completed  ──────────► failed
```

A `BenchmarkReconciler` (`@Cron("*/30 * * * * *")` — every 30s) sweeps `running` and `submitted` runs and:
- if `running` for > `maxDurationSeconds`, calls `driver.cancel()` then sets `failed`;
- if the K8s Job no longer exists and the run is not in a terminal state, sets `failed` with `stateMessage="job vanished"`;
- if the underlying pod is in `Failed` phase but no metrics callback arrived, sets `failed` with the pod's termination reason.

This makes the design tolerant of dropped callbacks. The callback is the happy path; the reconciler is the safety net.

## 8. Web UI

### 8.1 Routes

- `/benchmarks` — list page
- `/benchmarks/:id` — detail page

Sidebar entry "基准测试" (i18n key `sidebar.benchmark`) added between "压力测试" and other items.

### 8.2 List Page

- TanStack Query for `GET /api/benchmarks` with cursor pagination.
- Table columns: name, model, profile (badge), state (badge with color: pending=gray, running=blue+spinner, completed=green, failed=red, canceled=gray), throughput (output tokens/s), TTFT mean, created at, actions (cancel if running, delete).
- Filter row: state select, profile select, name search.
- "Add benchmark" button opens the create modal.

### 8.3 Create Modal

Two tabs (mirrors GPUStack screenshot):

**基本信息 tab**:
- Name (required)
- Description (textarea, optional)
- Endpoint section: API type (chat / completion), API URL, API key, model — laid out same as LoadTest's endpoint picker so the components can be reused.

**配置 tab**:
- Profile (radio chips: Throughput / Latency / Long Context / Generation Heavy / ShareGPT / Custom). Picking a non-Custom profile fills the fields below; switching to Custom unlocks them for editing. The ShareGPT chip is disabled in Phase 1 with a "(coming soon)" tooltip — consistent with §1.3 deferring the ShareGPT dataset.
- Dataset (select: Random / ShareGPT — ShareGPT option is disabled in Phase 1 with a "(coming soon)" badge).
- Input token length (number, default per profile).
- Output token length (number, default per profile).
- Request rate (number, 0 = unlimited).
- Total requests (number).

Submit → `POST /api/benchmarks` → close modal → invalidate list query → navigate to detail page of the new run.

### 8.4 Detail Page

- Header: name, state badge, cancel/delete buttons.
- Config card: target endpoint, profile, dataset config.
- Metrics grid: 12 tiles in a 4×3 layout — TTFT mean/p95/p99, ITL mean/p95/p99, output tok/s, RPS, concurrency mean/max, success/error counts.
- Polling: every 2s while `state ∈ {pending, submitted, running}`; stops on terminal state.
- Logs panel: collapsible `<pre>`, scrollable, monospace. Logs are posted by the runner in a single chunk on the final `/metrics` callback (after guidellm exits — success or failure). While the run is `pending`/`submitted`/`running` the panel shows "Logs available after run completes". Live tailing is Phase 6.
- (Out of scope: charts. Just numbers in MVP.)

### 8.5 i18n

New namespace `benchmark` with: page titles, all field labels, profile names, state labels, error messages. Mirrors the existing `load-test` namespace structure.

## 9. Testing Strategy

| Layer | Test type | What's covered |
|---|---|---|
| `runner.py` | pytest, mocks `subprocess.Popen` and `requests.post` | argv construction, JSON→summary mapping, error propagation, HMAC token usage |
| Runner image | integration test in CI: build image, run against a stub OpenAI server (Python `aiohttp`), assert callback HTTP calls match expected sequence | end-to-end runner behavior |
| `BenchmarkService` | vitest, mocks Prisma + Driver | state transitions, ownership scoping, validation, callback handling |
| `K8sJobDriver` | vitest, mocks `@kubernetes/client-node` | Job manifest correctness (env, labels, RBAC SA, TTL, resource limits) |
| `BenchmarkController` | vitest with NestJS testing module + supertest | route registration, JWT/HMAC guards, Zod validation, error shape |
| `HmacCallbackGuard` | vitest | valid token accepted, expired rejected, wrong signature rejected, constant-time compare |
| `BenchmarkReconciler` | vitest | runaway timeout, missing job, pod failure → failed transitions |
| Web | vitest + RTL | profile picker fills fields, modal submit, list filter, detail polling |
| E2E (deferred) | playwright in 4pd dev cluster, real guidellm against a tiny `vllm serve facebook/opt-125m` | full happy path, runs in a CI gate before each release |

## 10. Phase Decomposition

Each phase is one PR from `feat/benchmark-phase-<N>` cut from `main`. Same convention as the NestJS refactor.

### Phase 1 — Data + contracts
- Prisma migration adding `benchmark_runs`.
- `packages/contracts/src/benchmark.ts` (request, response, summary, list-query schemas).
- AES-GCM helper (`apps/api/src/common/crypto/`).
- `BenchmarkExecutionDriver` interface (no impls yet).
- Unit tests for crypto helper.
- **Output**: schema and contracts approved; nothing externally observable.

### Phase 2 — Runner image
- `apps/benchmark-runner/` Python project + Dockerfile + tests.
- Image build job in CI on changes under that path.
- `docker run --rm -e ... modeldoctor/benchmark-runner:dev` smoke test against a tiny OpenAI stub.
- **Output**: pushable runner image, callable manually.

### Phase 3 — K8sJobDriver + callback API
- `K8sJobDriver` using `@kubernetes/client-node`.
- `/api/internal/benchmarks/:id/{state,metrics}` controller + `HmacCallbackGuard`.
- `BenchmarkReconciler` with `@nestjs/schedule`.
- ServiceAccount + Role + RoleBinding YAML in `deploy/k8s/rbac.yaml` (only what the API needs to manage Jobs).
- Local dev path: `kubectl apply` the RBAC, run API with `~/.kube/config`, run a benchmark, see the Job appear and finish, see metrics appear in the DB.
- **Output**: end-to-end flow without a UI.

### Phase 4 — User-facing CRUD API
- `BenchmarkController`, `BenchmarkService`.
- `Create`, `List` (cursor + filters), `Detail`, `Cancel`, `Delete`.
- User scoping (admin sees all).
- API key encryption at rest.
- **Output**: feature usable via curl.

### Phase 5 — Web UI
- `apps/web/src/features/benchmark/` with list page, detail page, create modal.
- Profile presets + form auto-fill.
- Polling on detail page.
- i18n namespace `benchmark` (zh + en).
- Sidebar entry.
- **Output**: full feature visible.

### Phase 6 — Hardening (optional follow-up)
- E2E test in CI hitting 4pd.
- ShareGPT support: download dataset on Job startup with init container, runner wires `--data /data/sharegpt.json`.
- `SubprocessDriver` fallback for local-without-K8s dev.
- Live-tail logs (SSE).

Phases 1–5 are MVP. Phase 6 is post-MVP.

## 11. Open Risks

1. **guidellm CLI / output schema churn.** Mitigation: pin a specific version in `apps/benchmark-runner/pyproject.toml`. Bumping is a deliberate PR with new fixture-based tests.
2. **In-cluster networking from runner → API service.** Assumes `modeldoctor-api` is reachable as `modeldoctor-api.<ns>.svc:3001` from the `modeldoctor-benchmarks` namespace. If the user uses NetworkPolicies, an explicit allow rule is needed. Documented in Phase 3 README; not generated.
3. **K8s API rate limits / quota.** A flood of benchmark creations could create a flood of Jobs. MVP relies on the existing throttler for `/api/benchmarks` POST (100 req/min already configured globally) and on K8s namespace quotas for runtime. No application-level concurrent-job cap in MVP — flagged for Phase 6 if needed.
4. **Runner image size.** ~600 MB. First pull on a fresh node can take 30–60s. ImagePullPolicy `IfNotPresent` (default) plus tagged releases should keep this rare.
5. **HMAC secret rotation.** Rotating `BENCHMARK_CALLBACK_SECRET` invalidates in-flight runs. Acceptable: callers can re-create. Documented in deploy README.
6. **Token-counter mismatch.** guidellm uses HuggingFace tokenizers. If the user's target is a model whose tokenizer guidellm doesn't auto-detect, prompt-token / output-token accounting can drift. Phase 1 leaves this as user error; Phase 6 may add an explicit `tokenizer` field.

## 12. Glossary

- **TTFT** — Time To First Token; ms from POST sent to first SSE chunk received.
- **ITL** — Inter-Token Latency; ms between consecutive output tokens within a single response.
- **TPOT** — Time Per Output Token; mean per-token cost across a request (≈ ITL mean ignoring first).
- **Prefill** — the inference phase that processes the input prompt; bounded by GPU compute.
- **Decode** — the inference phase that emits output tokens; bounded by memory bandwidth.
- **guidellm** — Neural Magic / vLLM-team OSS LLM benchmarking CLI; the execution engine here.
- **Profile** — a named workload preset (Throughput / Latency / etc.).
- **Driver** — pluggable execution backend (`K8sJobDriver`, future `SubprocessDriver`).
- **HMAC token** — per-run callback credential; `HMAC_SHA256(secret, "<id>.<exp>")`.
