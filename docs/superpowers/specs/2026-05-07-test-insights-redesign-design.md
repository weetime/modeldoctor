# 测试洞察重设计 — Profile 系统 + AI 智能诊断

**Date:** 2026-05-07
**Status:** Draft (awaiting user review)
**Builds on:** `2026-05-07-test-insights-detail-design.md` (replaces the minimal detail view shipped in #141)

---

## 1. Context

### 1.1 Current state

`#141` shipped a minimal test insights detail page (`TestInsightsDetailPage`) with:

- Connection meta header
- Summary card (run count) + tool distribution bar
- p95 timeseries chart
- Run history table

Pain points reported by user (2026-05-07):

1. **List page (`EndpointReportsPage`) lacks search/filter row** at the top. Users with many connections cannot narrow by name, model, or category.
2. **Card CTA "查看历史"** is mis-named — semantically the page is a *detail* view, not just history.
3. **Detail page is "without data" and weak** — currently empty for low-traffic connections, and even when populated has no synthesis. Doesn't deliver on "this is the core value of the product."
4. **No constructive recommendations** — page shows raw numbers, leaves interpretation to the user. User wants prescriptive findings ("TTFT > 1s = 高危, 建议 X") delivered automatically.
5. **No cross-test aggregation across scenarios/tools/templates** — a connection's full picture across `inference` / `capacity` / `gateway` scenarios and across multiple templates/tools is the real "model 档案."

### 1.2 Goal

Turn the detail page into a **scenario-driven, recommendation-first model performance dossier** that:

- Aggregates all runs on a connection across the three scenarios (`inference` / `capacity` / `gateway`)
- Derives a **composite score** + **per-scenario sub-scores** from a deterministic check engine
- Surfaces **ranked findings** with actionable recommendations, sourced from a **Profile system** (chatbot / rag / code-completion / long-form / default)
- Provides **AI 综合诊断** powered by a user-configured external OpenAI-compatible LLM, fed with profile findings + baseline-relative + fleet-relative comparison data
- Adds **list-page search/filter** row and renames CTA to **查看详情**

### 1.3 Non-goals (this PR)

- Multi-LLM-provider support (one provider per user, can extend later)
- Profile editing UI in V1 (built-in profiles only; clone/import/export → V2)
- Fleet-level cron job (compute fleet aggregates lazily on detail page open, capped query scope)
- LLM streaming response (return full markdown; UI shows skeleton during generation)
- Per-template grouping of runs within a scenario panel (V2 — see §13)

---

## 2. Information architecture (detail page)

```
┌─────────────────────────────────────────────────────────────┐
│ PageHeader                                                  │
│   Title: <connection.name>                                  │
│   Subtitle: <baseUrl> · <model> · <category>                │
│   RightSlot: [评估画像 chatbot ▾] [近 30 天 ▾] [返回]       │
├─────────────────────────────────────────────────────────────┤
│ Hero Score Banner                                           │
│   ◉ 综合雷达 (6 axes)    综合评分 87 / 100 · 良好           │
│                          18 检测项 · 25 次测试 · 近 30 天   │
│                          推理 92 · 容量 75 · 网关 82        │
├─────────────────────────────────────────────────────────────┤
│ Findings Card (Profile 规则产出 — top 5 ranked)             │
│   🔴 [推理] TTFT p95 = 1240ms (chatbot 阈值 800ms) — 高危  │
│      建议：检查模型加载/批合并；增加预热请求量              │
│   🟡 [容量] 最大稳定 QPS = 12 — 偏低                        │
│   🟡 [网关] 长尾比 8.4× — 抖动大                            │
│   🟢 [推理] 错误率 0.04%                                    │
│   🟢 [容量] 内存增长线性                                    │
│   ▾ 展开全部 18 项检测                                      │
├─────────────────────────────────────────────────────────────┤
│ AI 智能诊断 ✨                                              │
│   [生成 AI 诊断] (未生成时)                                 │
│   --- OR ---                                                │
│   ⚙ 主要问题：首字延迟显著高于同类                         │
│      你的 TTFT p95 (1240ms) 比你过往同模板中位数 (920ms)   │
│      高 35%，且高于同类 chat 模型平均 50%。基于 chatbot     │
│      用例：1) 优先排查模型加载策略 2) 检查请求预热 3) ...   │
│   ⚙ 次要问题：吞吐偏低                                      │
│      ...                                                    │
│   📊 数据来源：profile=chatbot · 自历史 12 次               │
│      · 同类对比 8 个连接 · 生成于 2h ago [↻ 刷新]          │
│   --- OR ---                                                │
│   尚未配置 LLM 提供商 → [前往设置]                          │
├─────────────────────────────────────────────────────────────┤
│ Per-scenario sections (3, in fixed order)                   │
│   ┌───────────────────────────────────────────────────────┐ │
│   │ 推理性能基准 [子分 92] · 12 次 · guidellm × 2 模板    │ │
│   │ ┌──────┐  关键指标：TTFT/ITL/p95/p99/err/throughput  │ │
│   │ │雷达  │  TTFT 趋势 [─────] (上升 ⚠)                 │ │
│   │ │      │  p95 趋势  [─────] (持平)                   │ │
│   │ └──────┘  ┌──────────────────────────────────────┐   │ │
│   │           │ 本场景 findings (折叠 → 展开)        │   │ │
│   │           └──────────────────────────────────────┘   │ │
│   │           [查看本场景全部测试 → /benchmarks?...]      │ │
│   └───────────────────────────────────────────────────────┘ │
│   ┌── 容量规划 [75] · 5 次 · ... ──────────────────────┐    │
│   ┌── 网关压测 [82] · 8 次 · ... ──────────────────────┐    │
└─────────────────────────────────────────────────────────────┘
```

**Empty-state per scenario**: when `runs[scenario] === 0`, render placeholder card with CTA "尚无 X 测试 · [创建第一次测试 →]". The score and radar are not computed for empty scenarios; composite score skips them (equal-weight average over scenarios that have data).

---

## 3. Profile system

### 3.1 Concept

A **Profile** is a named bundle of `{ check thresholds, weights, axis weights }`. Each connection is associated with one profile (default `default`). All scoring/findings on the detail page are computed against the active profile.

### 3.2 Data model

```prisma
// New table — built-in profiles seeded via migration; user-created later (V2).
model EvaluationProfile {
  id          String   @id @default(cuid())
  slug        String   @unique  // 'default' | 'chatbot' | 'rag' | 'code-completion' | 'long-form'
  name        String   // localized display name (zh-CN by convention; lookup via i18n key)
  nameKey     String?  @map("name_key")  // i18n key — null for user-created custom profiles
  description String?  @db.Text
  isBuiltin   Boolean  @default(false) @map("is_builtin")
  createdBy   String?  @map("created_by") // null for built-ins
  // Source — JSON with shape { checks: { [checkId]: { warn, crit, weight? } }, axisWeights: { [axisId]: number } }
  rules       Json
  source      String?  @db.Text  // citation / rationale (markdown)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  creator     User?        @relation("UserCreatedProfiles", fields: [createdBy], references: [id], onDelete: SetNull)
  connections Connection[] @relation("ConnectionEvaluationProfile")

  @@index([slug])
  @@index([isBuiltin])
  @@map("evaluation_profiles")
}

// Connection ← evaluationProfileId (nullable; null falls back to 'default').
model Connection {
  // ...existing fields...
  evaluationProfileId String?            @map("evaluation_profile_id")
  evaluationProfile   EvaluationProfile? @relation("ConnectionEvaluationProfile", fields: [evaluationProfileId], references: [id], onDelete: SetNull)
}

model User {
  // ...existing fields...
  createdProfiles EvaluationProfile[] @relation("UserCreatedProfiles")
}
```

**Profile name resolution rule**: frontend prefers `nameKey` (i18n lookup, supports localization for built-ins); falls back to literal `name` field for user-created custom profiles (V2). Built-in seed rows always set both fields; `name` carries zh-CN copy as a safety net if i18n bundle missing.

**Migration** (Prisma `migrate dev --create-only`, manually edit only to add seed inserts after the table create):

```sql
-- Add column on connections
ALTER TABLE connections ADD COLUMN evaluation_profile_id TEXT;

-- Create evaluation_profiles + indexes (Prisma-generated)
CREATE TABLE evaluation_profiles ( ... );

-- Seed 5 built-in profiles
INSERT INTO evaluation_profiles (id, slug, name, name_key, is_builtin, rules, source, ...) VALUES
  ('clx_default',         'default',         '通用 (chatbot 中庸假设)', 'profiles.default.name',         true, '...JSON...', '...rationale...'),
  ('clx_chatbot',         'chatbot',         'Chatbot 实时对话',         'profiles.chatbot.name',         true, '...', '...'),
  ('clx_rag',             'rag',             'RAG 检索增强',             'profiles.rag.name',             true, '...', '...'),
  ('clx_code_completion', 'code-completion', 'Code Completion',          'profiles.code-completion.name', true, '...', '...'),
  ('clx_long_form',       'long-form',       'Long-Form 长文生成',       'profiles.long-form.name',       true, '...', '...');
```

**Note on built-in IDs**: use stable hand-picked cuids (or `'__builtin_default__'`-style sentinel strings) so `Connection.evaluationProfileId = 'clx_default'` survives across DB resets in dev.

### 3.3 Built-in profile rules (Layer 1 thresholds)

Sources cited in `EvaluationProfile.source`. All thresholds are *defaults*; user can clone any built-in to a custom profile (V2) and override.

#### `default` (通用，相当于 chatbot 中庸假设)

Same as `chatbot` profile but with looser TTFT (allow non-realtime use cases).

#### `chatbot` (实时对话)

| check_id | scenario | axis | warn | crit | weight | source |
|---|---|---|---|---|---|---|
| `inference.ttft.p95.ms` | inference | responsiveness | 500 | 1000 | 1.0 | OpenAI Playground subjective UX research; Anthropic Console SLO |
| `inference.ttft.p99.ms` | inference | responsiveness | 800 | 2000 | 0.5 | 1.6× p95 thresholds (typical p99/p95 ratio in well-behaved serving) |
| `inference.itl.p95.ms` | inference | smoothness | 60 | 120 | 0.7 | 50tok/s = 20ms ITL (smooth reading); warn at 60ms ≈ 17 tok/s, crit at 120ms ≈ 8 tok/s |
| `inference.e2e.p95.ms` | inference | responsiveness | 3000 | 8000 | 0.7 | typical chatbot total response budget (OpenAI/Anthropic Console p95 reported under load) |
| `inference.e2e.p99.ms` | inference | tail | 5000 | 15000 | 0.5 | 1.6-1.9× p95 thresholds (typical p99 spread) |
| `inference.error_rate` | inference | stability | 0.01 | 0.05 | 1.0 | industry SaaS SLO 99% / 99.9% |
| `inference.throughput.req_per_s` | inference | throughput | 10 | 5 | 0.5 | (lower is worse — `evaluate` flips comparison) |
| `capacity.max_qps` | capacity | throughput | 20 | 10 | 1.0 | derived from typical 1-replica vLLM Qwen-0.5B |
| `capacity.error_rate` | capacity | stability | 0.05 | 0.10 | 1.0 | capacity tests tolerate higher error |
| `capacity.tail_ratio` | capacity | tail | 5.0 | 10.0 | 0.7 | p99/p50 ratio |
| `gateway.error_rate` | gateway | stability | 0.005 | 0.02 | 1.0 | gateway should be more reliable than serving |
| `gateway.tail_ratio` | gateway | tail | 5.0 | 10.0 | 1.0 | (vegeta lat p99/p50) |
| `gateway.throughput.req_per_s` | gateway | throughput | 50 | 20 | 0.7 | gateway scenario is QPS-oriented |

Total per scenario: inference 7, capacity 3, gateway 3 (+ derived). Total: ~13 checks. Will grow with new checks; framework is open.

#### `rag` (相关性优先，宽容 TTFT)

Override on `chatbot`:
- `inference.ttft.p95.ms`: warn 1500 / crit 3000 (user expects retrieval delay)
- `inference.e2e.p95.ms`: warn 5000 / crit 12000
- Future: `relevance.ndcg` checks (V2)

#### `code-completion` (极致 TTFT)

Override:
- `inference.ttft.p95.ms`: warn 100 / crit 200 (must beat typing)
- `inference.itl.p95.ms`: warn 30 / crit 60
- weight on `responsiveness` axis = 2.0 (heaviest)

#### `long-form` (吞吐 + 容错)

Override:
- `inference.ttft.p95.ms`: warn 1000 / crit 3000
- `inference.itl.p95.ms`: warn 80 / crit 200
- `inference.error_rate`: warn 0.005 / crit 0.02 (stricter — long forms cost more, retries hurt)
- weight on `throughput` = 1.5

### 3.4 Profile resolution

```ts
// Frontend hook: resolves which profile applies to the current detail page.
function useActiveProfile(connectionId: string, override?: string) {
  const conn = useConnection(connectionId);
  const profiles = useEvaluationProfiles();
  const slug = override ?? conn.data?.evaluationProfile?.slug ?? 'default';
  return profiles.data?.find(p => p.slug === slug);
}
```

Profile switching in detail page header is **frontend-only** (client computes scores against the selected profile's rules; switching does NOT mutate `Connection.evaluationProfileId`). To persist, user clicks "设为此连接的默认画像" → PATCH `/connections/:id { evaluationProfileId }`.

---

## 4. Check engine

### 4.1 Check shape

```ts
// packages/contracts/src/insights/check.ts
export type ScenarioId = 'inference' | 'capacity' | 'gateway';
export type RadarAxisId =
  | 'responsiveness'
  | 'smoothness'
  | 'throughput'
  | 'stability'
  | 'tail'
  | 'efficiency';

export interface CheckDescriptor {
  id: string;                                  // 'inference.ttft.p95.ms'
  scenario: ScenarioId;
  toolFilter?: BenchmarkTool[];                // omit → applies to all tools
  axis: RadarAxisId;
  defaultWeight: number;                       // 0..2
  read: (m: SummaryMetrics) => number | null;  // reuse readP95Latency, readErrorRate, readThroughput
  // Direction: when 'higher_is_better' the warn/crit thresholds compare value < threshold = bad.
  // E.g. throughput.req_per_s with warn=10, crit=5 means: < 10 = warn, < 5 = crit.
  direction: 'lower_is_better' | 'higher_is_better';
  recommendationKey: string;                   // i18n: 'insights.findings.<id>.recommendation'
}

export interface ProfileRule {
  warn: number;
  crit: number;
  weight?: number;  // default = descriptor.defaultWeight
}

export interface ProfileRules {
  checks: Record<string, ProfileRule>;
  axisWeights?: Partial<Record<RadarAxisId, number>>;
}

export interface Finding {
  checkId: string;
  scenario: ScenarioId;
  axis: RadarAxisId;
  severity: 'good' | 'warn' | 'crit' | 'no_data';
  value: number | null;
  threshold: { warn: number; crit: number };
  weight: number;
  recommendation: string;          // i18n-resolved
  contributingRunIds: string[];    // for drill-down
}
```

### 4.2 Aggregation across runs

Single value per `(check, scenario)` per detail page render.

**Strategy**: `read()` is per-run; aggregate across runs in the time window using the **median** (more robust than mean for outliers):

```ts
function aggregateCheck(check: CheckDescriptor, runs: Run[]): number | null {
  const values = runs
    .filter(r => r.scenario === check.scenario && r.status === 'completed')
    .filter(r => !check.toolFilter || check.toolFilter.includes(r.tool))
    .map(r => check.read(r.summaryMetrics))
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return median(values);
}
```

`contributingRunIds` populated as the IDs of the runs whose values fell in the IQR (excluding outliers).

### 4.3 Severity & scoring

```ts
function evaluate(check: CheckDescriptor, value: number | null, rule: ProfileRule): Severity {
  if (value === null) return 'no_data';
  if (check.direction === 'lower_is_better') {
    if (value >= rule.crit) return 'crit';
    if (value >= rule.warn) return 'warn';
    return 'good';
  } else {
    if (value <= rule.crit) return 'crit';
    if (value <= rule.warn) return 'warn';
    return 'good';
  }
}

const SEVERITY_SCORE = { good: 1.0, warn: 0.5, crit: 0.0, no_data: null };

function scenarioScore(findings: Finding[]): number | null {
  const scored = findings.filter(f => f.severity !== 'no_data');
  if (scored.length === 0) return null;
  const sumWeighted = scored.reduce((acc, f) => acc + SEVERITY_SCORE[f.severity]! * f.weight, 0);
  const sumWeights  = scored.reduce((acc, f) => acc + f.weight, 0);
  return Math.round((sumWeighted / sumWeights) * 100);
}

function compositeScore(perScenario: Record<ScenarioId, number | null>): number | null {
  const present = Object.values(perScenario).filter((s): s is number => s !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);  // equal-weight, skip nulls
}
```

### 4.4 Radar axis aggregation

Each radar axis is a normalized 0-1 value, displayed on a hexagon (or N-gon when more axes added). For axis `A`:

```ts
function axisValue(axis: RadarAxisId, findings: Finding[]): number | null {
  const onAxis = findings.filter(f => f.axis === axis && f.severity !== 'no_data');
  if (onAxis.length === 0) return null;
  const score = onAxis.reduce((acc, f) => acc + SEVERITY_SCORE[f.severity]! * f.weight, 0);
  const weights = onAxis.reduce((acc, f) => acc + f.weight, 0);
  return score / weights;  // 0..1
}
```

**Initial 6 axes**: `responsiveness`, `smoothness`, `throughput`, `stability`, `tail`, `efficiency`.

For V1, only **5 axes are actively populated** (responsiveness, smoothness, throughput, stability, tail). `efficiency` is reserved for future capacity-derived metrics (e.g., requests-per-GB-VRAM, cost-per-1k-tokens) and rendered as a placeholder grey vertex on the radar so the hexagon shape stays consistent. Axes with `axisValue` = null show as the minimum spoke (0) with a tooltip "无对应检测项".

### 4.5 Where this lives

```
packages/contracts/src/insights/
  check.ts                  # types only
  profile.ts                # ProfileRules type
apps/web/src/features/insights/  # NEW directory (renamed from benchmarks/TestInsights*)
  checks/
    descriptors.ts          # CheckDescriptor[] — all check definitions
    inference.ts            # inference scenario checks
    capacity.ts             # capacity scenario checks
    gateway.ts              # gateway scenario checks
  evaluate.ts               # evaluate / scenarioScore / compositeScore / axisValue
  Profile selector + ProfileBadge + ScoreBanner + RadarChart components
```

**Migration of existing files**: Move and rename — most of the old `TestInsights*` becomes obsolete because the structure is wholly different.

| Old | Action |
|---|---|
| `features/benchmarks/TestInsightsDetailPage.tsx` | Rewrite as `features/insights/InsightsDetailPage.tsx` (new structure) |
| `features/benchmarks/TestInsightsP95Chart.tsx` | **Delete** (replaced by per-scenario sparklines in panels) |
| `features/benchmarks/TestInsightsRunsTable.tsx` | **Delete** (the "view all runs" link goes to existing `/benchmarks?...` list page; no embedded table) |
| `features/benchmarks/__tests__/TestInsights*.test.tsx` | Delete corresponding tests; new tests under `features/insights/__tests__/` |

`EndpointReportsPage` stays in `benchmarks/` (it's still the benchmarks-section index) but its detail link points to `/insights/:connectionId`.

---

## 5. AI 综合诊断 (LLM judge)

### 5.1 Provider data model

```prisma
model LlmJudgeProvider {
  id            String   @id @default(cuid())
  userId        String   @unique @map("user_id")  // singleton per user (for V1)
  baseUrl       String   @map("base_url")          // e.g. https://api.deepseek.com/v1
  apiKeyCipher  String   @map("api_key_cipher")    // AES-256-GCM v1 (reuse common/crypto/aes-gcm.ts)
  model         String                             // e.g. deepseek-chat
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("llm_judge_providers")
}

model User {
  // ...existing...
  llmJudgeProvider LlmJudgeProvider?
}
```

**Rationale** for separate table over reusing `Connection`:
- `Connection.category` is `ModalityCategory` (chat/embeddings/...), semantically the "model under test." Adding a `purpose: 'serving' | 'judge'` field would pollute the connection picker, baseline UI, benchmark creation flow, etc.
- Per-user singleton is the simplest UX (V1); a separate model enables multi-provider extension (V2) without retro-fitting filters across the codebase.
- Encryption already factored into `common/crypto/aes-gcm.ts` — reuse, don't duplicate.

### 5.2 Settings UI

New section in existing `SettingsPage` (`apps/web/src/features/settings/SettingsPage.tsx`):

```
┌─ AI 智能诊断 ────────────────────────────────────────┐
│ 启用 AI 智能诊断  [○ 开关]                          │
│                                                       │
│ Base URL         [https://api.deepseek.com/v1   ]    │
│ API Key          [sk-***                        ] 👁  │
│ Model            [deepseek-chat                 ]    │
│                                                       │
│ 协议：OpenAI Chat Completions（兼容 DeepSeek、       │
│       通义、Moonshot、本地 vLLM/Ollama 等）          │
│                                                       │
│ [测试连接]              [保存]                       │
└───────────────────────────────────────────────────────┘
```

Form follows project convention: `<Form>` + `<FormField>` + `<FormSection title="AI 智能诊断" description="...">` + `<FormActions submitLabel cancelLabel>`.

**Test connection** action: POST `/api/llm-judge/test` with form payload (no DB write); backend issues a tiny `chat.completions` call and returns `{ ok, latencyMs, error? }`.

### 5.3 Backend endpoints

```
GET    /api/llm-judge/provider             → { provider | null }    # current user's provider (no apiKey returned)
PUT    /api/llm-judge/provider             → upsert provider        # body: { baseUrl, apiKey, model, enabled }
DELETE /api/llm-judge/provider             → 204
POST   /api/llm-judge/test                 → { ok, latencyMs, error? }  # body: { baseUrl, apiKey, model } (no DB write)

POST   /api/insights/:connectionId/synthesize   → { findings: NarrativeFinding[], generatedAt, runIdsHash }
                                              # body: { profileSlug, range, runIds[] }   (frontend supplies the same data it already has)
                                              # backend builds prompt + comparison data, calls user's provider
```

`/api/insights/:connectionId/synthesize` is **synchronous** (5-20s response). Frontend shows skeleton + cancel button; uses `AbortController` to cancel.

### 5.4 Prompt design

**V1 language scope**: zh-CN only. The synthesize endpoint always uses the Chinese system prompt; output is always Chinese. Users with English UI still get Chinese AI narrative for V1 (low cost to ship; en-US system prompt can land in V2 if anyone asks). Document this clearly in the en-US settings UI ("AI 诊断当前仅输出中文").

System prompt (zh-CN, hardcoded V1):

```
你是一位 LLM 服务性能顾问。给定一个模型连接在指定时间范围内的基准测试数据，
你需要：

1. 找出 3-5 个最值得用户关注的问题（按严重性排序）
2. 每个问题给出：标题、量化的指标根因、可执行的建议（1-3 步）
3. 仅基于提供的数据推断；不要编造未提供的数字
4. 用户的业务画像（profile）会影响你判断"严重"的标准 — 优先采用 profile 视角

输出 JSON：
{
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short>",
      "rootCause": "<2-3 sentences quoting metrics>",
      "recommendations": ["<step 1>", "<step 2>"]
    }
  ]
}
```

User prompt (assembled by backend):

```json
{
  "connection": { "name": "...", "model": "...", "category": "chat" },
  "profile": { "slug": "chatbot", "name": "Chatbot 实时对话", "rationale": "..." },
  "timeRange": { "from": "...", "to": "..." },
  "scenarios": [
    {
      "id": "inference",
      "subScore": 92,
      "runCount": 12,
      "tools": ["guidellm"],
      "metrics": {
        "ttft.p95.ms": { "value": 1240, "warn": 500, "crit": 1000 },
        "...": { ... }
      },
      "findings": [
        { "checkId": "...", "severity": "crit", "value": 1240, ... }
      ]
    }
  ],
  "baselineComparison": {
    "inference.ttft.p95.ms": { "currentP50": 1240, "historicalP50": 920, "historicalP90": 1100, "deltaPct": 35, "sampleSize": 12 }
  },
  "fleetComparison": {
    "inference.ttft.p95.ms": { "currentP50": 1240, "fleetP50": 800, "fleetP90": 1500, "sampleSize": 8 }
  }
}
```

Output is `NarrativeFinding[]`:

```ts
interface NarrativeFinding {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  rootCause: string;
  recommendations: string[];
}
```

Rendered in the AI 智能诊断 card as a list with severity badges.

### 5.5 Caching

Cache key: `(connectionId, profileSlug, rangeISO, runIdsHash)`. Cache TTL 24h.

`runIdsHash`: `sha256(sorted(runIds.map(r => r.id + ':' + r.updatedAt.toISOString())).join(','))` — includes per-run timestamps, so cache invalidates when a run is added, deleted, or updated (e.g., a re-completed rerun). Pure ID-only hash would miss in-place updates.

Storage: in-memory LRU on the API process for V1 (max 100 entries; bounded by per-user request rate). Future: Redis when multi-replica.

UI: shows `[最新生成 2h ago] [↻ 刷新]`. Refresh bypasses cache.

### 5.6 Baseline / Fleet comparison data

Separate read-only endpoints (called by `synthesize` server-side; not directly by frontend):

```
GET /api/insights/:connectionId/baseline-comparison?range=...&profileSlug=...
  → for each check that has historical data:
    { checkId, currentP50, historicalP50, historicalP90, deltaPct, sampleSize }
    # currentP50 = median across runs in the request range
    # historicalP50/P90 = computed from runs OUTSIDE the request range but still on this connection

GET /api/insights/:connectionId/fleet-comparison?range=...&profileSlug=...
  → for each check across all connections in same category:
    { checkId, currentP50, fleetP50, fleetP90, sampleSize }
    # currentP50 = median for THIS connection in the range
    # fleetP50/P90 = aggregated across all OTHER connections of same category in the range
```

**V1 fleet scope**: aggregate across the user's own connections within the same `category` (no cross-user fleet — privacy/scaling; revisit V2).

**Cold-start handling**: if `sampleSize < 3`, omit that check from comparison data (don't ship ambiguous numbers to the LLM).

### 5.7 Failure modes & graceful degradation

| Condition | UI state |
|---|---|
| No provider configured | Section: "尚未配置 LLM 提供商 → [前往设置]" |
| Provider disabled | Section: "AI 智能诊断已停用 → [设置]" |
| Generation timeout (>30s) | "生成超时，请重试" + retry button |
| Provider returns non-200 | "AI 服务返回错误：<code>" + retry |
| LLM returns malformed JSON | "AI 输出解析失败 → [刷新]" + log to server for debugging |
| 0 runs in range | Section hidden entirely (no point synthesizing) |

---

## 6. List page changes (`EndpointReportsPage`)

### 6.1 Filter row (new)

Insert above the cards grid (below PageHeader subtitle, above the cards):

```
┌────────────────────────────────────────────────────────────────┐
│ [🔍 搜索连接名/模型]   [类别 ▾]  [画像 ▾]  时间 [近30天 ▾]   │
└────────────────────────────────────────────────────────────────┘
```

Fields:
- **Search box**: matches `connection.name` OR `connection.model` (case-insensitive contains)
- **类别 ▾**: select with options = distinct `Connection.category` values from current results + "全部"
- **画像 ▾**: select with profile slugs + "全部"
- **时间**: existing range select (7d / 30d / 90d) — moved from PageHeader rightSlot to filter row

Filter logic: client-side (the `/api/benchmarks/endpoint-reports` endpoint already returns full list scoped to user; filter in React state). If list grows beyond 100 connections, revisit server-side filtering.

URL state: `?q=...&category=...&profile=...&range=30d` so links are shareable / refreshable.

### 6.2 Card CTA rename

Change `t("reports.viewHistory")` → `t("reports.viewDetail")` with new value:
- zh-CN: `查看详情`
- en-US: `View detail`

The button styling stays the same; only the label changes. Old i18n key kept around 1 release for backwards compat in case of stale clients (low priority — can remove immediately if no concern).

---

## 7. Routing

```
/benchmarks/reports             → EndpointReportsPage (list, with filters)
/benchmarks/reports/:id         → REDIRECT → /insights/:id (preserve search params)
/insights/:connectionId         → InsightsDetailPage (renamed)
```

Sidebar item "测试洞察" → updated to point to `/benchmarks/reports` (no change).

**Redirect implementation**: in `apps/web/src/router/index.tsx`, replace the `<Route path="/benchmarks/reports/:id" element={<TestInsightsDetailPage />} />` line with:

```tsx
<Route
  path="/benchmarks/reports/:id"
  element={
    <Navigate
      to={location =>
        `/insights/${useParams().id}${location.search}`
      }
      replace
    />
  }
/>
<Route path="/insights/:connectionId" element={<InsightsDetailPage />} />
```

(actual implementation may use a small `<RedirectToInsights />` wrapper component since react-router's `Navigate` doesn't take a function; functional equivalent is fine).

---

## 8. Per-scenario panel detail

Each scenario panel (3 of them, fixed order) renders:

```
┌─ 推理性能基准 [子分 92] ───────────────────────────┐
│ ◉ 子雷达     12 次 · guidellm · 跨 2 模板          │
│              关键指标趋势：                         │
│              TTFT  ────╲     p95   ────             │
│                     ⚠ ↑              持平          │
│              ┌─ 本场景 findings (默认折叠) ─────┐  │
│              │ 🔴 TTFT p95 高危                  │  │
│              │ 🟢 5 项达标                       │  │
│              │ ▾ 展开 (5)                        │  │
│              └────────────────────────────────────┘ │
│              [查看本场景 12 次测试 →]               │
└────────────────────────────────────────────────────┘
```

**子雷达**: same axes as composite, scoped to checks in this scenario.

**Trend mini-charts**: 2 sparklines with arrow indicator (↑↓→) showing direction of change between first and last quartile in the window.

**Findings list**: defaults collapsed (showing only severity counts); user expands to see full list. Shared component with the top-level findings card.

**链接到 benchmarks 列表**: `/benchmarks?connectionId=...&scenario=inference&from=...&to=...` — uses existing list page filters (which already support these query params — see `listBenchmarksQuerySchema`).

---

## 9. i18n keys (additions)

```ts
// apps/web/src/locales/zh-CN/insights.json (NEW namespace)
{
  "title": "测试洞察",
  "subtitle": "按连接聚合的模型性能档案",
  "detail": {
    "backToIndex": "返回测试洞察",
    "compositeScore": "综合评分",
    "scenarioScore": "场景子分",
    "checks": "{{count}} 项检测",
    "runs": "{{count}} 次测试",
    "in": "近 {{days}} 天",
    "profile": {
      "label": "评估画像",
      "switch": "切换画像",
      "setDefault": "设为此连接默认画像",
      "default": "通用",
      "chatbot": "Chatbot 实时对话",
      "rag": "RAG 检索增强",
      "code-completion": "Code Completion",
      "long-form": "Long-Form 长文生成"
    },
    "findings": {
      "title": "关键发现",
      "expandAll": "展开全部 {{count}} 项检测",
      "noFindings": "本时间范围内无检测项数据",
      "severity": {
        "good": "良好",
        "warn": "中等",
        "crit": "高危",
        "no_data": "无数据"
      }
    },
    "ai": {
      "title": "AI 智能诊断",
      "generate": "生成 AI 诊断",
      "generating": "生成中…（约 5-15 秒）",
      "cancel": "取消",
      "refresh": "刷新",
      "lastGenerated": "最新生成 {{when}}",
      "providerMissing": "尚未配置 LLM 提供商",
      "goToSettings": "前往设置",
      "providerDisabled": "AI 智能诊断已停用",
      "error": {
        "timeout": "生成超时，请重试",
        "providerError": "AI 服务返回错误：{{code}}",
        "parseFailed": "AI 输出解析失败"
      },
      "dataSource": "数据来源：profile={{profile}} · 自历史 {{baselineCount}} 次 · 同类对比 {{fleetCount}} 个连接"
    },
    "scenario": {
      "inference": "推理性能基准",
      "capacity": "容量规划",
      "gateway": "网关压测",
      "viewAll": "查看本场景 {{count}} 次测试",
      "empty": {
        "title": "尚无 {{scenario}} 测试",
        "cta": "创建第一次测试"
      }
    },
    "trend": {
      "rising": "上升",
      "falling": "下降",
      "stable": "持平"
    }
  },
  "checks": {
    "inference": {
      "ttft": {
        "p95": { "label": "TTFT p95", "recommendation": "TTFT (首字延迟) 偏高 — 检查模型加载策略、批合并 (continuous batching) 设置；考虑增加请求预热 (warmup) 让冷启动期请求不进统计。" },
        "p99": { ... }
      },
      "itl": { ... },
      "e2e": { ... },
      "error_rate": { ... },
      "throughput": { ... }
    },
    "capacity": { ... },
    "gateway": { ... }
  }
}
```

```ts
// apps/web/src/locales/zh-CN/benchmarks.json — UPDATE
{
  "reports": {
    "viewDetail": "查看详情",       // NEW (was viewHistory)
    "filters": {
      "search": "搜索连接名/模型",
      "category": "类别",
      "categoryAll": "全部类别",
      "profile": "画像",
      "profileAll": "全部画像",
      "noResults": "无匹配结果"
    }
  }
}
```

```ts
// apps/web/src/locales/zh-CN/settings.json — UPDATE
{
  "ai": {
    "title": "AI 智能诊断",
    "description": "配置外部 LLM 服务作为 ModelDoctor 的 AI 顾问。仅用于详情页智能诊断生成。",
    "enabled": "启用",
    "baseUrl": "Base URL",
    "baseUrlHint": "OpenAI 兼容协议端点",
    "apiKey": "API Key",
    "apiKeyHint": "保存后服务端 AES-256-GCM 加密存储",
    "model": "模型名",
    "modelHint": "示例：deepseek-chat、qwen-turbo、gpt-4o-mini",
    "test": "测试连接",
    "testSuccess": "连接成功（耗时 {{ms}}ms）",
    "testFailed": "连接失败：{{error}}"
  }
}
```

en-US mirrors zh-CN one-for-one (omitted for brevity in this spec).

---

## 10. API surface (consolidated)

```
# Profile (V1: read-only built-ins; V2: CRUD)
GET    /api/insights/profiles                      → EvaluationProfile[]
GET    /api/insights/profiles/:slug                → EvaluationProfile

# LLM judge provider (per-user singleton)
GET    /api/llm-judge/provider                     → LlmJudgeProvider | null  (apiKey redacted)
PUT    /api/llm-judge/provider                     → upsert (encrypts apiKey before write)
DELETE /api/llm-judge/provider                     → 204
POST   /api/llm-judge/test                         → { ok, latencyMs, error? }

# Insights synthesis
GET    /api/insights/:connectionId/baseline-comparison?range=&profileSlug=
GET    /api/insights/:connectionId/fleet-comparison?range=&profileSlug=
POST   /api/insights/:connectionId/synthesize
   body: { profileSlug, range, runIds[] }
   resp: { findings: NarrativeFinding[], generatedAt, runIdsHash, fromCache: boolean }

# Connection profile setter (existing PATCH /connections/:id with new field)
PATCH  /api/connections/:id                        → body: { evaluationProfileId? }
```

---

## 11. Testing strategy

### 11.1 Unit (Vitest)

**Frontend**:
- `evaluate.ts`: full coverage of severity transitions for each direction (lower/higher_is_better); composite score formula edge cases (all null, single scenario, etc.); axis aggregation
- `checks/descriptors.ts` × test data: golden tests verifying each check returns expected severity for representative metric values
- `ProfileBadge`, `ScoreBanner`, `RadarChart` snapshot tests
- `InsightsDetailPage` integration: mock `useBenchmarkList` + `useEvaluationProfiles`, verify profile switch recomputes score

**Backend**:
- `LlmJudgeProvider` service: encrypt-on-write, redact-on-read, decrypt-only-in-synthesize
- `synthesize` controller: prompt assembly correctness; cache hit/miss; error mapping (provider error → 502 with code)
- `baseline-comparison` & `fleet-comparison` services: median calculation, sample-size cutoff

### 11.2 HTTP e2e (Vitest + supertest)

- `PUT /api/llm-judge/provider` round-trip: write → read returns redacted → DB row has cipher
- `POST /api/llm-judge/test`: stub OpenAI endpoint with fastify-like mock; verify request shape (auth header, body)
- `POST /api/insights/:id/synthesize`: stub LLM provider; verify caching + prompt assembly; verify graceful degradation when 0 runs

### 11.3 Browser e2e (Playwright)

- Settings flow: configure provider → test → save → returns to settings; verify section now shows "已配置"
- Detail page flow: visit `/insights/:id`, switch profile → score updates; click "生成 AI 诊断" → mock LLM returns canned response → verify rendered
- List page filter flow: type search query → cards filter; change category → cards filter; URL params persisted
- Profile switch persistence: click "设为默认" → reload → profile remains selected
- Old route redirect: visit `/benchmarks/reports/:id` → redirected to `/insights/:id`

### 11.4 Manual smoke

- Configure DeepSeek provider with real key → visit a populated detail page → click 生成 → verify reasonable narrative in zh-CN
- Test with each of 5 built-in profiles to verify thresholds produce different findings on the same data
- Empty state: detail page for connection with 0 runs

---

## 12. Migration & rollout

### 12.1 DB migration (Prisma)

Single migration `add_evaluation_profiles_and_llm_judge`:

```sql
-- 1. evaluation_profiles table + seed 5 built-ins
-- 2. ALTER connections ADD COLUMN evaluation_profile_id (nullable)
-- 3. llm_judge_providers table
```

Generated via `pnpm prisma migrate dev --create-only --name add_evaluation_profiles_and_llm_judge`. Manually edit only to add INSERT statements for built-in profiles after the `CREATE TABLE`. (Per CLAUDE.md memory: never hand-write SQL except for seed data.)

### 12.2 Encryption key

Reuse `ENCRYPTION_KEY` env (already used by `Connection.apiKeyCipher`). No new env var.

### 12.3 Feature flag

None. Ships as default. The "AI 智能诊断" section gracefully degrades when no provider configured, so it's safe to enable for all users immediately.

### 12.4 Backwards compatibility

- Existing `Connection.apiKeyCipher` rows untouched
- Existing `EndpointReportsPage` URL `/benchmarks/reports` unchanged
- Existing detail URL `/benchmarks/reports/:id` redirects (don't break bookmarks)
- Existing i18n key `reports.viewHistory` removed in same commit (file is internal; no caller-cache risk)

---

## 13. Open questions / future work (NOT in this PR)

- **V2: Profile editing UI** — clone built-in, override per-check thresholds, JSON import/export. Spec deferred until user demand surfaces.
- **V2: Per-template grouping in scenario panels** — when a scenario has 3+ templates, scoring them separately and surfacing "your `chat-stress-v2` is the slow one" is more actionable than a single aggregated number.
- **V2: Multi-LLM-provider** — let user configure providers and pick per-request (e.g., "fast" small model for quick check, "deep" frontier model for detailed diagnosis).
- **V2: Cross-user fleet aggregates** — privacy/scaling considerations defer this. V1 is per-user same-category only.
- **V2: LLM streaming** — for long narratives, stream tokens to reduce perceived latency.
- **V2: Profile recommendation engine** — suggest a profile based on observed traffic patterns ("looks like RAG — switch profile?").
- **V2: en-US AI narrative** — V1 is zh-CN only; add en-US system prompt and route by `Accept-Language`.
- **V2: `efficiency` axis** — add capacity-derived checks (e.g., `capacity.tokens_per_gb_vram`) to fully populate the 6th axis.

---

## 14. Implementation order (proposed for writing-plans)

Single PR, phase-per-commit (per CLAUDE.md memory: prefer single PR for structurally-coupled work):

1. **Schema + migration**: `EvaluationProfile`, `LlmJudgeProvider`, `Connection.evaluationProfileId`. Seed 5 built-in profiles.
2. **Contracts**: `Check`, `ProfileRules`, `Finding`, `LlmJudgeProvider` Zod schemas in `packages/contracts`.
3. **Check engine (frontend)**: `descriptors.ts` per scenario, `evaluate.ts`, unit tests.
4. **Insights detail page (no AI yet)**: rename `TestInsightsDetailPage` → `InsightsDetailPage`, route, score banner, radar, findings card, 3 scenario panels. Profile switcher (frontend-only).
5. **List page filters + rename CTA**: search/category/profile filters, `viewHistory` → `viewDetail`.
6. **Backend: profile API + connection.evaluationProfileId**: GET profiles, PATCH connection profile.
7. **Backend: LLM judge provider CRUD + test endpoint**.
8. **Settings UI**: AI 智能诊断 section + form + test action.
9. **Backend: baseline-comparison + fleet-comparison endpoints**.
10. **Backend: synthesize endpoint**: prompt assembly, OpenAI client, in-memory LRU cache.
11. **Frontend: AI 智能诊断 card**: render flow, generate button, refresh, error states.
12. **e2e + manual smoke**.
13. **i18n full coverage** (zh-CN + en-US).
14. **Docs**: update `apps/api/CLAUDE.md` (new endpoints), `README.md` (note ENCRYPTION_KEY now also covers LLM judge), this spec stays in `docs/superpowers/specs/`.

Each step is its own commit on `feat/test-insights-redesign`. Aim: single PR `#142` (or next number).

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| LLM provider returns non-OpenAI-compliant output | Strict JSON-mode request + Zod validation + parse-failure fallback UI |
| Cache key collision when runs change but `runIds` stable | `runIdsHash` = `sha256(sorted(runIds.map(r => r.id + ':' + r.updatedAt.toISOString())).join(','))` — includes timestamps so re-running an existing benchmark invalidates cache |
| User leaks API key via "测试连接" payload echoed in error | Test endpoint returns generic error codes; never echoes request body |
| Composite score swings dramatically when user switches profiles | OK — that's the point. UI shows "评估画像 chatbot" prominently; switch is reversible |
| Built-in profile thresholds wrong / outdated | `EvaluationProfile.source` documents rationale; can be adjusted via migration without code changes |
| Median aggregation hides bimodal distributions | V2: surface IQR / standard deviation in tooltips; V1 is "good enough" |
| Empty fleet (1 connection in user's category) | `sampleSize < 3` → omit from comparison data; LLM doesn't see misleading numbers |
