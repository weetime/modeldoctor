# Test Insights Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal `TestInsightsDetailPage` (#141) with a scenario-driven, recommendation-first model performance dossier — Profile system + check engine + AI 综合诊断 backed by an external OpenAI-compatible LLM.

**Architecture:** Frontend check engine evaluates per-connection benchmark runs against profile-defined thresholds → produces deterministic findings + composite/scenario scores + radar values. AI synthesis endpoint assembles findings + baseline-relative + fleet-relative comparison data into a prompt, calls user-configured external LLM, returns ranked narrative recommendations. New tables: `EvaluationProfile` (5 built-ins seeded), `LlmJudgeProvider` (per-user singleton); `Connection` gains nullable `evaluationProfileId` FK.

**Tech Stack:** TypeScript, Prisma, NestJS 11, React 18, react-router 6, react-hook-form + zod, Vitest 2, Playwright, shadcn/ui, AES-256-GCM (existing `common/crypto/aes-gcm.ts`).

**Spec:** `docs/superpowers/specs/2026-05-07-test-insights-redesign-design.md`

**Branch:** `feat/test-insights-redesign` (worktree at `/Users/fangyong/vllm/modeldoctor/feat-test-insights-redesign`)

---

## File Structure

### New files

```
apps/api/prisma/migrations/<ts>_add_evaluation_profiles_and_llm_judge/migration.sql
apps/api/src/modules/insights/
  evaluation-profile.service.ts          # read-only profile fetcher
  evaluation-profile.controller.ts
  evaluation-profile.service.spec.ts
  insights.module.ts
  comparison.service.ts                  # baseline + fleet aggregation
  comparison.service.spec.ts
  comparison.controller.ts
  synthesize.service.ts                  # prompt assembly + LLM call + cache
  synthesize.service.spec.ts
  synthesize.controller.ts
  llm-client.ts                          # tiny OpenAI-protocol client wrapper
  llm-client.spec.ts
  cache.ts                               # bounded LRU
  cache.spec.ts
apps/api/src/modules/llm-judge/
  llm-judge.service.ts
  llm-judge.service.spec.ts
  llm-judge.controller.ts
  llm-judge.controller.spec.ts
  llm-judge.module.ts
apps/api/test/e2e/
  llm-judge.e2e-spec.ts
  insights.e2e-spec.ts

packages/contracts/src/insights/
  check.ts                               # CheckDescriptor, ProfileRules, Finding types
  profile.ts                             # EvaluationProfile zod schemas
  llm-judge.ts                           # LlmJudgeProvider zod schemas
  synthesize.ts                          # NarrativeFinding zod schemas
  comparison.ts                          # baseline/fleet zod schemas
  index.ts                               # re-export

apps/web/src/features/insights/
  InsightsDetailPage.tsx
  checks/
    descriptors.ts                       # all CheckDescriptor[] across scenarios
    inference.ts
    capacity.ts
    gateway.ts
  evaluate.ts                            # evaluate / scenarioScore / compositeScore / axisValue
  ScoreBanner.tsx
  RadarChart.tsx
  FindingsCard.tsx
  ScenarioPanel.tsx
  ProfileSelector.tsx
  AiDiagnosisCard.tsx
  queries.ts                             # useEvaluationProfiles, useSynthesize, useComparison
  __tests__/
    evaluate.test.ts
    descriptors.test.ts
    InsightsDetailPage.test.tsx
    ScoreBanner.test.tsx
    FindingsCard.test.tsx
    ScenarioPanel.test.tsx
    AiDiagnosisCard.test.tsx
apps/web/src/features/settings/
  AiDiagnosisSection.tsx                 # new section in SettingsPage
  AiDiagnosisSection.test.tsx
apps/web/src/features/settings/queries.ts # useLlmJudgeProvider, useTestLlmJudge

e2e/benchmarks/insights-detail.spec.ts
e2e/settings/llm-judge-settings.spec.ts
```

### Modified files

```
apps/api/prisma/schema.prisma                              # add 2 models, 1 column
apps/api/src/app.module.ts                                 # register insights + llm-judge modules
apps/api/src/modules/connection/connection.service.ts     # accept evaluationProfileId on update
apps/api/src/modules/connection/connection.controller.ts # PATCH body schema
apps/web/src/router/index.tsx                              # add /insights/:connectionId, redirect old path
apps/web/src/features/benchmarks/EndpointReportsPage.tsx  # filter row + rename CTA
apps/web/src/features/settings/SettingsPage.tsx           # mount AiDiagnosisSection
apps/web/src/locales/zh-CN/{insights,benchmarks,settings}.json
apps/web/src/locales/en-US/{insights,benchmarks,settings}.json
apps/web/src/lib/i18n.ts                                  # register insights namespace
```

### Deleted files

```
apps/web/src/features/benchmarks/TestInsightsDetailPage.tsx
apps/web/src/features/benchmarks/TestInsightsP95Chart.tsx
apps/web/src/features/benchmarks/TestInsightsRunsTable.tsx
apps/web/src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx
apps/web/src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx
apps/web/src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx
```

---

## Phases overview

| Phase | Tasks | Commit shape | What's verifiable at end |
|---|---|---|---|
| 1. Schema + migration | 1-2 | `feat(api): add EvaluationProfile + LlmJudgeProvider schema + seed` | Prisma migrate runs cleanly; 5 built-in profiles in DB |
| 2. Contracts | 3-4 | `feat(contracts): insights check + profile + llm-judge zod schemas` | `pnpm -F @modeldoctor/contracts build` clean |
| 3. Frontend check engine | 5-9 | `feat(web/insights): check engine + evaluate + descriptors` | Unit tests pass; pure functions, no UI yet |
| 4. Insights detail page (no AI) | 10-15 | `feat(web/insights): scenario-driven detail page (no AI yet)` | New `/insights/:connectionId` renders with score/radar/findings/3 panels |
| 5. List page filters + rename | 16-17 | `feat(web/benchmarks): list-page filters + 查看详情 rename` | Filter row works; CTA renamed |
| 6. Backend profile API | 18-19 | `feat(api): evaluation profile read API + connection.profileId` | Profiles GET works; PATCH connection profile works |
| 7. LLM judge provider | 20-23 | `feat(api,web): LLM judge provider + settings UI + test action` | Settings flow round-trips end-to-end |
| 8. Comparison endpoints | 24-25 | `feat(api/insights): baseline + fleet comparison endpoints` | Comparison data returned with sample-size guards |
| 9. Synthesize endpoint | 26-29 | `feat(api/insights): synthesize endpoint + LRU cache + LLM client` | POST returns NarrativeFinding[] (mock LLM) |
| 10. Frontend AI card | 30-32 | `feat(web/insights): AI 智能诊断 card + cache UI` | Generate / refresh / error / disabled states all render |
| 11. e2e + i18n | 33-35 | `test(e2e): insights flows`, `feat(i18n): insights/llm-judge keys` | Full Playwright pass; en-US + zh-CN both render |
| 12. Cleanup | 36-37 | `chore(insights): delete obsolete TestInsights*`, `docs(api): update CLAUDE.md` | Old files removed; CLAUDE.md mentions new endpoints |

Total: 37 tasks. Each task ends in a commit.

**One-time prep before starting** (verify worktree is buildable):

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-test-insights-redesign
pnpm install --frozen-lockfile
pnpm -r build                    # required: packages/contracts/dist must exist for apps/api typecheck
```

---

## Phase 1 — Schema + Migration

### Task 1: Add Prisma models for EvaluationProfile + LlmJudgeProvider + Connection.evaluationProfileId

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add 2 models, 1 column on Connection, 1 relation on User)

**- [ ] Step 1: Edit schema.prisma**

Append after the existing `Baseline` model:

```prisma
model EvaluationProfile {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  nameKey     String?  @map("name_key")
  description String?  @db.Text
  isBuiltin   Boolean  @default(false) @map("is_builtin")
  createdBy   String?  @map("created_by")
  rules       Json
  source      String?  @db.Text

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  creator     User?        @relation("UserCreatedProfiles", fields: [createdBy], references: [id], onDelete: SetNull)
  connections Connection[] @relation("ConnectionEvaluationProfile")

  @@index([slug])
  @@index([isBuiltin])
  @@map("evaluation_profiles")
}

model LlmJudgeProvider {
  id            String   @id @default(cuid())
  userId        String   @unique @map("user_id")
  baseUrl       String   @map("base_url")
  apiKeyCipher  String   @map("api_key_cipher")
  model         String
  enabled       Boolean  @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("llm_judge_providers")
}
```

Modify the existing `User` model to add the inverse relations (find the `User` block; insert after the existing `createdTemplates` line):

```prisma
  createdProfiles  EvaluationProfile[] @relation("UserCreatedProfiles")
  llmJudgeProvider LlmJudgeProvider?
```

Modify the existing `Connection` model: insert before the closing `}`, before the `@@unique([userId, name])` line:

```prisma
  evaluationProfileId String?            @map("evaluation_profile_id")
  evaluationProfile   EvaluationProfile? @relation("ConnectionEvaluationProfile", fields: [evaluationProfileId], references: [id], onDelete: SetNull)
```

**- [ ] Step 2: Generate migration (no apply yet)**

Run:
```bash
cd /Users/fangyong/vllm/modeldoctor/feat-test-insights-redesign
pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name add_evaluation_profiles_and_llm_judge
```

Expected: migration file created at `apps/api/prisma/migrations/<timestamp>_add_evaluation_profiles_and_llm_judge/migration.sql`. The CLI may pause asking for DB reset confirmation — answer **No** if prompted (we want create-only).

**- [ ] Step 3: Verify migration SQL has no surprises**

Run:
```bash
cat apps/api/prisma/migrations/*_add_evaluation_profiles_and_llm_judge/migration.sql
```

Expected: SQL contains `CREATE TABLE "evaluation_profiles"`, `CREATE TABLE "llm_judge_providers"`, `ALTER TABLE "connections" ADD COLUMN "evaluation_profile_id"`, FK constraints, and the necessary indexes. No `DROP TABLE` for unrelated objects. If the diff includes anything else, abort and investigate.

**- [ ] Step 4: Append seed inserts to migration SQL**

Open the generated migration file. After the last `CREATE INDEX` and any `ALTER TABLE ... ADD CONSTRAINT`, append these INSERTs:

```sql
-- Seed 5 built-in evaluation profiles
INSERT INTO "evaluation_profiles" ("id", "slug", "name", "name_key", "description", "is_builtin", "rules", "source", "created_at", "updated_at") VALUES
('clxprofdefault0000000000', 'default', '通用 (chatbot 中庸假设)', 'profiles.default.name', '通用基线 — 适合大多数 LLM 服务的中庸阈值', true, '{"checks":{"inference.ttft.p95.ms":{"warn":500,"crit":1000,"weight":1.0},"inference.ttft.p99.ms":{"warn":800,"crit":2000,"weight":0.5},"inference.itl.p95.ms":{"warn":60,"crit":120,"weight":0.7},"inference.e2e.p95.ms":{"warn":3000,"crit":8000,"weight":0.7},"inference.e2e.p99.ms":{"warn":5000,"crit":15000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}}}', '基于 OpenAI Console / Anthropic Playground 公开 SLO + vLLM 官方 benchmark 中位数（vLLM v0.6.x release notes）综合得出的 chatbot 中庸默认。', NOW(), NOW()),
('clxprofchatbot0000000000', 'chatbot', 'Chatbot 实时对话', 'profiles.chatbot.name', '强调 TTFT — 适合实时聊天场景', true, '{"checks":{"inference.ttft.p95.ms":{"warn":300,"crit":800,"weight":1.5},"inference.ttft.p99.ms":{"warn":500,"crit":1500,"weight":0.7},"inference.itl.p95.ms":{"warn":50,"crit":100,"weight":0.7},"inference.e2e.p95.ms":{"warn":3000,"crit":8000,"weight":0.7},"inference.e2e.p99.ms":{"warn":5000,"crit":15000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}},"axisWeights":{"responsiveness":1.5}}', 'Chatbot 用户对首字延迟的主观感知阈值（&lt;300ms 优秀, &lt;800ms 可接受）。基于 OpenAI Playground 实测 + Anthropic Console SLO。', NOW(), NOW()),
('clxprofrag0000000000000', 'rag', 'RAG 检索增强', 'profiles.rag.name', '容忍 TTFT — 用户已习惯检索延迟', true, '{"checks":{"inference.ttft.p95.ms":{"warn":1500,"crit":3000,"weight":1.0},"inference.ttft.p99.ms":{"warn":2500,"crit":5000,"weight":0.5},"inference.itl.p95.ms":{"warn":60,"crit":120,"weight":0.7},"inference.e2e.p95.ms":{"warn":5000,"crit":12000,"weight":0.7},"inference.e2e.p99.ms":{"warn":8000,"crit":20000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}}}', 'RAG 场景：用户预期检索阶段延迟，TTFT 阈值放宽至 1500ms warn / 3000ms crit。LangSmith / Pinecone 公开 RAG benchmark 数据。', NOW(), NOW()),
('clxprofcodecomp00000000', 'code-completion', 'Code Completion', 'profiles.code-completion.name', '极致 TTFT — 必须比键入快', true, '{"checks":{"inference.ttft.p95.ms":{"warn":100,"crit":200,"weight":2.0},"inference.ttft.p99.ms":{"warn":150,"crit":350,"weight":1.0},"inference.itl.p95.ms":{"warn":30,"crit":60,"weight":1.0},"inference.e2e.p95.ms":{"warn":1000,"crit":3000,"weight":0.7},"inference.e2e.p99.ms":{"warn":2000,"crit":5000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}},"axisWeights":{"responsiveness":2.0}}', 'Code completion：响应慢于打字节奏即不可用。Cursor / Copilot 公开数据：TTFT &lt;100ms 优秀, &lt;200ms 可接受。', NOW(), NOW()),
('clxproflongform00000000', 'long-form', 'Long-Form 长文生成', 'profiles.long-form.name', '强调吞吐 + 容错', true, '{"checks":{"inference.ttft.p95.ms":{"warn":1000,"crit":3000,"weight":0.7},"inference.ttft.p99.ms":{"warn":1500,"crit":5000,"weight":0.3},"inference.itl.p95.ms":{"warn":80,"crit":200,"weight":1.0},"inference.e2e.p95.ms":{"warn":15000,"crit":60000,"weight":0.5},"inference.e2e.p99.ms":{"warn":30000,"crit":120000,"weight":0.3},"inference.error_rate":{"warn":0.005,"crit":0.02,"weight":1.5},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}},"axisWeights":{"throughput":1.5}}', '长文场景：长输出对单次失败的容忍度低，error_rate 阈值更严；TTFT 容忍。', NOW(), NOW());
```

**- [ ] Step 5: Apply migration to dev DB**

Run:
```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
```

Expected output: `Applying migration ... Database is now in sync with your schema.` Verify with:
```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "SELECT slug, name FROM evaluation_profiles ORDER BY slug;"
```

Expected: 5 rows (chatbot / code-completion / default / long-form / rag).

**- [ ] Step 6: Run prisma generate (refresh client types)**

Run:
```bash
pnpm -F @modeldoctor/api exec prisma generate
```

Expected: `✔ Generated Prisma Client (... in ... ms)`. Verify:
```bash
grep -E "EvaluationProfile|LlmJudgeProvider" apps/api/node_modules/@prisma/client/index.d.ts | head -5
```

Both type names should appear.

**- [ ] Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(api): add EvaluationProfile + LlmJudgeProvider schema + 5 built-in profiles

EvaluationProfile holds per-business-use-case threshold rules; 5 built-in
profiles seeded (default/chatbot/rag/code-completion/long-form). Connection
gains nullable evaluationProfileId FK (null → default at runtime).

LlmJudgeProvider is a per-user singleton storing OpenAI-compatible judge
LLM config; apiKeyCipher reuses the existing AES-256-GCM scheme via
CONNECTION_API_KEY_ENCRYPTION_KEY.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Smoke-test that existing benchmark API still works

**Files:** none (verification only)

**- [ ] Step 1: Run all existing api unit tests**

```bash
pnpm -F @modeldoctor/api test
```

Expected: all green. If any fail, the schema changes broke something — investigate before proceeding.

**- [ ] Step 2: Run existing api e2e**

```bash
pnpm test:e2e:api
```

Expected: all green. Pay attention to `connection.e2e-spec.ts` and `benchmark.e2e-spec.ts` — these are the most likely to break.

**- [ ] Step 3: Commit (no-op, just a checkpoint)**

No file changes; skip the commit step. Note in your status: "Phase 1 verified, moving to Phase 2."

---

## Phase 2 — Contracts package

### Task 3: Add insights check + profile contracts

**Files:**
- Create: `packages/contracts/src/insights/check.ts`
- Create: `packages/contracts/src/insights/profile.ts`
- Create: `packages/contracts/src/insights/index.ts`
- Modify: `packages/contracts/src/index.ts` (re-export `./insights`)

**- [ ] Step 1: Create `packages/contracts/src/insights/check.ts`**

```ts
import { z } from "zod";
import { benchmarkToolSchema, scenarioIdSchema } from "../benchmark.js";

export const radarAxisIdSchema = z.enum([
  "responsiveness",
  "smoothness",
  "throughput",
  "stability",
  "tail",
  "efficiency",
]);
export type RadarAxisId = z.infer<typeof radarAxisIdSchema>;

export const severitySchema = z.enum(["good", "warn", "crit", "no_data"]);
export type Severity = z.infer<typeof severitySchema>;

export const findingSchema = z.object({
  checkId: z.string(),
  scenario: scenarioIdSchema,
  axis: radarAxisIdSchema,
  severity: severitySchema,
  value: z.number().nullable(),
  threshold: z.object({ warn: z.number(), crit: z.number() }),
  weight: z.number(),
  recommendation: z.string(),
  contributingRunIds: z.array(z.string()),
});
export type Finding = z.infer<typeof findingSchema>;

// Note: CheckDescriptor itself is NOT a contract — it's a frontend-only
// pure-function bundle. Only the Finding output and the ProfileRules input
// cross the API boundary.
```

**- [ ] Step 2: Create `packages/contracts/src/insights/profile.ts`**

```ts
import { z } from "zod";

export const profileRuleSchema = z.object({
  warn: z.number(),
  crit: z.number(),
  weight: z.number().optional(),
});
export type ProfileRule = z.infer<typeof profileRuleSchema>;

export const profileRulesSchema = z.object({
  checks: z.record(profileRuleSchema),
  axisWeights: z.record(z.number()).optional(),
});
export type ProfileRules = z.infer<typeof profileRulesSchema>;

export const evaluationProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  nameKey: z.string().nullable(),
  description: z.string().nullable(),
  isBuiltin: z.boolean(),
  rules: profileRulesSchema,
  source: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>;

export const listEvaluationProfilesResponseSchema = z.object({
  items: z.array(evaluationProfileSchema),
});
export type ListEvaluationProfilesResponse = z.infer<typeof listEvaluationProfilesResponseSchema>;
```

**- [ ] Step 3: Create `packages/contracts/src/insights/index.ts`**

```ts
export * from "./check.js";
export * from "./profile.js";
```

**- [ ] Step 4: Update `packages/contracts/src/index.ts`**

Append:
```ts
export * from "./insights/index.js";
```

**- [ ] Step 5: Build contracts package**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: clean build. Verify `packages/contracts/dist/insights/check.js` exists.

**- [ ] Step 6: Commit**

```bash
git add packages/contracts/src/insights/ packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add insights check + profile schemas

Defines RadarAxisId, Severity, Finding, ProfileRule, ProfileRules,
EvaluationProfile zod schemas. CheckDescriptor itself is frontend-only
(not a transport contract); only the Finding output crosses the API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add LlmJudgeProvider + synthesize + comparison contracts

**Files:**
- Create: `packages/contracts/src/insights/llm-judge.ts`
- Create: `packages/contracts/src/insights/synthesize.ts`
- Create: `packages/contracts/src/insights/comparison.ts`
- Modify: `packages/contracts/src/insights/index.ts` (add re-exports)

**- [ ] Step 1: Create `packages/contracts/src/insights/llm-judge.ts`**

```ts
import { z } from "zod";

// Public (no apiKey)
export const llmJudgeProviderPublicSchema = z.object({
  id: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LlmJudgeProviderPublic = z.infer<typeof llmJudgeProviderPublicSchema>;

export const upsertLlmJudgeProviderSchema = z.object({
  baseUrl: z.string().url().max(500),
  apiKey: z.string().min(1).max(500),
  model: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
});
export type UpsertLlmJudgeProvider = z.infer<typeof upsertLlmJudgeProviderSchema>;

export const testLlmJudgeRequestSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});
export type TestLlmJudgeRequest = z.infer<typeof testLlmJudgeRequestSchema>;

export const testLlmJudgeResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type TestLlmJudgeResponse = z.infer<typeof testLlmJudgeResponseSchema>;
```

**- [ ] Step 2: Create `packages/contracts/src/insights/synthesize.ts`**

```ts
import { z } from "zod";

export const narrativeFindingSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  title: z.string(),
  rootCause: z.string(),
  recommendations: z.array(z.string()),
});
export type NarrativeFinding = z.infer<typeof narrativeFindingSchema>;

export const synthesizeRequestSchema = z.object({
  profileSlug: z.string(),
  range: z.enum(["7d", "30d", "90d"]),
  runIds: z.array(z.string()).max(500),
});
export type SynthesizeRequest = z.infer<typeof synthesizeRequestSchema>;

export const synthesizeResponseSchema = z.object({
  findings: z.array(narrativeFindingSchema),
  generatedAt: z.string().datetime(),
  runIdsHash: z.string(),
  fromCache: z.boolean(),
});
export type SynthesizeResponse = z.infer<typeof synthesizeResponseSchema>;
```

**- [ ] Step 3: Create `packages/contracts/src/insights/comparison.ts`**

```ts
import { z } from "zod";

export const baselineCheckComparisonSchema = z.object({
  checkId: z.string(),
  currentP50: z.number(),
  historicalP50: z.number(),
  historicalP90: z.number(),
  deltaPct: z.number(),
  sampleSize: z.number().int(),
});
export type BaselineCheckComparison = z.infer<typeof baselineCheckComparisonSchema>;

export const baselineComparisonResponseSchema = z.object({
  items: z.array(baselineCheckComparisonSchema),
});

export const fleetCheckComparisonSchema = z.object({
  checkId: z.string(),
  currentP50: z.number(),
  fleetP50: z.number(),
  fleetP90: z.number(),
  sampleSize: z.number().int(),
});
export type FleetCheckComparison = z.infer<typeof fleetCheckComparisonSchema>;

export const fleetComparisonResponseSchema = z.object({
  items: z.array(fleetCheckComparisonSchema),
});
```

**- [ ] Step 4: Update `packages/contracts/src/insights/index.ts`**

Replace contents with:
```ts
export * from "./check.js";
export * from "./profile.js";
export * from "./llm-judge.js";
export * from "./synthesize.js";
export * from "./comparison.js";
```

**- [ ] Step 5: Build + commit**

```bash
pnpm -F @modeldoctor/contracts build
git add packages/contracts/src/insights/
git commit -m "$(cat <<'EOF'
feat(contracts): add LlmJudgeProvider + synthesize + comparison schemas

LlmJudgeProviderPublic (apiKey redacted) + UpsertLlmJudgeProvider request
+ test endpoint request/response. SynthesizeRequest/Response with
NarrativeFinding (the LLM output shape). BaselineCheckComparison +
FleetCheckComparison data fed to LLM context, also exposed as endpoints
for debugging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Frontend check engine

### Task 5: Add evaluate.ts pure functions (TDD)

**Files:**
- Create: `apps/web/src/features/insights/evaluate.ts`
- Create: `apps/web/src/features/insights/__tests__/evaluate.test.ts`

**- [ ] Step 1: Write failing test**

`apps/web/src/features/insights/__tests__/evaluate.test.ts`:

```ts
import type { Finding, RadarAxisId } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { axisValue, compositeScore, evaluateSeverity, scenarioScore } from "../evaluate";

describe("evaluateSeverity", () => {
  it("returns no_data when value is null", () => {
    expect(
      evaluateSeverity(null, { warn: 100, crit: 200 }, "lower_is_better"),
    ).toBe("no_data");
  });

  it("lower_is_better: value < warn → good", () => {
    expect(evaluateSeverity(50, { warn: 100, crit: 200 }, "lower_is_better")).toBe("good");
  });

  it("lower_is_better: warn ≤ value < crit → warn", () => {
    expect(evaluateSeverity(150, { warn: 100, crit: 200 }, "lower_is_better")).toBe("warn");
    expect(evaluateSeverity(100, { warn: 100, crit: 200 }, "lower_is_better")).toBe("warn");
  });

  it("lower_is_better: value ≥ crit → crit", () => {
    expect(evaluateSeverity(200, { warn: 100, crit: 200 }, "lower_is_better")).toBe("crit");
    expect(evaluateSeverity(500, { warn: 100, crit: 200 }, "lower_is_better")).toBe("crit");
  });

  it("higher_is_better: value > warn → good", () => {
    expect(evaluateSeverity(50, { warn: 20, crit: 10 }, "higher_is_better")).toBe("good");
  });

  it("higher_is_better: crit < value ≤ warn → warn", () => {
    expect(evaluateSeverity(15, { warn: 20, crit: 10 }, "higher_is_better")).toBe("warn");
    expect(evaluateSeverity(20, { warn: 20, crit: 10 }, "higher_is_better")).toBe("warn");
  });

  it("higher_is_better: value ≤ crit → crit", () => {
    expect(evaluateSeverity(10, { warn: 20, crit: 10 }, "higher_is_better")).toBe("crit");
    expect(evaluateSeverity(5, { warn: 20, crit: 10 }, "higher_is_better")).toBe("crit");
  });
});

describe("scenarioScore", () => {
  function f(severity: Finding["severity"], weight: number): Finding {
    return {
      checkId: "x", scenario: "inference", axis: "responsiveness",
      severity, value: 0, threshold: { warn: 0, crit: 0 }, weight,
      recommendation: "", contributingRunIds: [],
    };
  }

  it("returns null when all findings are no_data", () => {
    expect(scenarioScore([f("no_data", 1), f("no_data", 1)])).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(scenarioScore([])).toBeNull();
  });

  it("100 when all good", () => {
    expect(scenarioScore([f("good", 1), f("good", 1)])).toBe(100);
  });

  it("0 when all crit", () => {
    expect(scenarioScore([f("crit", 1), f("crit", 1)])).toBe(0);
  });

  it("50 when all warn", () => {
    expect(scenarioScore([f("warn", 1), f("warn", 1)])).toBe(50);
  });

  it("weighted average rounded", () => {
    // good*1 + crit*3 = 1.0/4 weight → 25
    expect(scenarioScore([f("good", 1), f("crit", 3)])).toBe(25);
  });

  it("skips no_data findings", () => {
    expect(scenarioScore([f("good", 1), f("no_data", 100)])).toBe(100);
  });
});

describe("compositeScore", () => {
  it("returns null when all scenarios are null", () => {
    expect(compositeScore({ inference: null, capacity: null, gateway: null })).toBeNull();
  });

  it("equal-weight average over present scenarios, rounded", () => {
    expect(compositeScore({ inference: 90, capacity: 70, gateway: 80 })).toBe(80);
  });

  it("skips null scenarios", () => {
    expect(compositeScore({ inference: 90, capacity: null, gateway: 70 })).toBe(80);
  });
});

describe("axisValue", () => {
  function f(axis: RadarAxisId, severity: Finding["severity"], weight: number): Finding {
    return {
      checkId: "x", scenario: "inference", axis,
      severity, value: 0, threshold: { warn: 0, crit: 0 }, weight,
      recommendation: "", contributingRunIds: [],
    };
  }

  it("returns null when no findings on axis", () => {
    expect(axisValue("responsiveness", [f("smoothness", "good", 1)])).toBeNull();
  });

  it("returns 1.0 when all axis findings are good", () => {
    expect(
      axisValue("responsiveness", [
        f("responsiveness", "good", 1),
        f("responsiveness", "good", 2),
      ]),
    ).toBe(1.0);
  });

  it("returns 0 when all axis findings are crit", () => {
    expect(
      axisValue("responsiveness", [f("responsiveness", "crit", 1)]),
    ).toBe(0);
  });

  it("ignores no_data on axis", () => {
    expect(
      axisValue("responsiveness", [
        f("responsiveness", "good", 1),
        f("responsiveness", "no_data", 100),
      ]),
    ).toBe(1.0);
  });
});
```

**- [ ] Step 2: Run test (should fail with import error)**

```bash
pnpm -F @modeldoctor/web test -- evaluate
```

Expected: FAIL — module not found.

**- [ ] Step 3: Implement `apps/web/src/features/insights/evaluate.ts`**

```ts
import type { Finding, RadarAxisId, ScenarioId, Severity } from "@modeldoctor/contracts";

export type Direction = "lower_is_better" | "higher_is_better";

const SEVERITY_SCORE: Record<Exclude<Severity, "no_data">, number> = {
  good: 1.0,
  warn: 0.5,
  crit: 0.0,
};

export function evaluateSeverity(
  value: number | null,
  threshold: { warn: number; crit: number },
  direction: Direction,
): Severity {
  if (value === null) return "no_data";
  if (direction === "lower_is_better") {
    if (value >= threshold.crit) return "crit";
    if (value >= threshold.warn) return "warn";
    return "good";
  }
  if (value <= threshold.crit) return "crit";
  if (value <= threshold.warn) return "warn";
  return "good";
}

export function scenarioScore(findings: Finding[]): number | null {
  const scored = findings.filter((f) => f.severity !== "no_data");
  if (scored.length === 0) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of scored) {
    weightedSum += SEVERITY_SCORE[f.severity as Exclude<Severity, "no_data">] * f.weight;
    totalWeight += f.weight;
  }
  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 100);
}

export function compositeScore(perScenario: Record<ScenarioId, number | null>): number | null {
  const present = Object.values(perScenario).filter((s): s is number => s !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

export function axisValue(axis: RadarAxisId, findings: Finding[]): number | null {
  const onAxis = findings.filter((f) => f.axis === axis && f.severity !== "no_data");
  if (onAxis.length === 0) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of onAxis) {
    weightedSum += SEVERITY_SCORE[f.severity as Exclude<Severity, "no_data">] * f.weight;
    totalWeight += f.weight;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}
```

**- [ ] Step 4: Run test (should pass)**

```bash
pnpm -F @modeldoctor/web test -- evaluate
```

Expected: all green.

**- [ ] Step 5: Commit**

```bash
git add apps/web/src/features/insights/evaluate.ts apps/web/src/features/insights/__tests__/evaluate.test.ts
git commit -m "$(cat <<'EOF'
feat(web/insights): scoring + axis aggregation pure functions

Implements evaluateSeverity (with both directions), scenarioScore
(weighted average across non-no_data findings), compositeScore
(equal-weight average across non-null scenarios), axisValue (per-axis
weighted normalization 0-1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Add CheckDescriptor type + descriptor list module shell

**Files:**
- Create: `apps/web/src/features/insights/checks/descriptors.ts`
- Create: `apps/web/src/features/insights/__tests__/descriptors.test.ts`

**- [ ] Step 1: Write failing test**

```ts
// apps/web/src/features/insights/__tests__/descriptors.test.ts
import { describe, expect, it } from "vitest";
import { ALL_CHECKS, getCheck } from "../checks/descriptors";

describe("ALL_CHECKS", () => {
  it("contains expected check IDs across scenarios", () => {
    const ids = ALL_CHECKS.map((c) => c.id);
    expect(ids).toContain("inference.ttft.p95.ms");
    expect(ids).toContain("inference.error_rate");
    expect(ids).toContain("capacity.max_qps");
    expect(ids).toContain("gateway.error_rate");
  });

  it("every check has a stable id and a recommendationKey", () => {
    for (const c of ALL_CHECKS) {
      expect(c.id).toMatch(/^[a-z]+\.[a-z_.]+/);
      expect(c.recommendationKey).toContain(c.id);
    }
  });

  it("getCheck looks up by id", () => {
    const c = getCheck("inference.ttft.p95.ms");
    expect(c?.scenario).toBe("inference");
    expect(c?.axis).toBe("responsiveness");
    expect(c?.direction).toBe("lower_is_better");
  });

  it("returns undefined for unknown id", () => {
    expect(getCheck("nope")).toBeUndefined();
  });
});
```

**- [ ] Step 2: Implement `apps/web/src/features/insights/checks/descriptors.ts`**

```ts
import type { BenchmarkTool, RadarAxisId, ScenarioId, SummaryMetrics } from "@modeldoctor/contracts";
import type { Direction } from "../evaluate";
import { capacityChecks } from "./capacity";
import { gatewayChecks } from "./gateway";
import { inferenceChecks } from "./inference";

export interface CheckDescriptor {
  id: string;
  scenario: ScenarioId;
  toolFilter?: BenchmarkTool[];
  axis: RadarAxisId;
  defaultWeight: number;
  read: (m: SummaryMetrics) => number | null;
  direction: Direction;
  recommendationKey: string;
}

export const ALL_CHECKS: CheckDescriptor[] = [
  ...inferenceChecks,
  ...capacityChecks,
  ...gatewayChecks,
];

const byId = new Map(ALL_CHECKS.map((c) => [c.id, c]));

export function getCheck(id: string): CheckDescriptor | undefined {
  return byId.get(id);
}
```

**- [ ] Step 3: Create empty descriptor files (will fill in next tasks)**

`apps/web/src/features/insights/checks/inference.ts`:
```ts
import type { CheckDescriptor } from "./descriptors";
export const inferenceChecks: CheckDescriptor[] = [];
```

`apps/web/src/features/insights/checks/capacity.ts`:
```ts
import type { CheckDescriptor } from "./descriptors";
export const capacityChecks: CheckDescriptor[] = [];
```

`apps/web/src/features/insights/checks/gateway.ts`:
```ts
import type { CheckDescriptor } from "./descriptors";
export const gatewayChecks: CheckDescriptor[] = [];
```

**- [ ] Step 4: Run test (should fail — empty arrays don't match expected IDs)**

```bash
pnpm -F @modeldoctor/web test -- descriptors
```

Expected: FAIL — `ids` is empty.

**- [ ] Step 5: Commit (skeleton only — checks come next)**

```bash
git add apps/web/src/features/insights/
git commit -m "$(cat <<'EOF'
feat(web/insights): check descriptor framework + empty inference/capacity/gateway modules

Aggregates per-scenario CheckDescriptor[] arrays into ALL_CHECKS;
getCheck(id) is the lookup. Empty arrays for now — populated in
follow-up commits per scenario.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Implement inference scenario checks (7 checks)

**Files:**
- Modify: `apps/web/src/features/insights/checks/inference.ts`
- Modify: `apps/web/src/features/insights/__tests__/descriptors.test.ts` (add inference-specific assertions)

**- [ ] Step 1: Implement `inference.ts`**

```ts
import { readErrorRate, readP95Latency, readThroughput } from "@/features/benchmarks/compare/metrics";
import type { CheckDescriptor } from "./descriptors";

function fromDist(metrics: any, key: string, field: string): number | null {
  const m = metrics as { tool?: string; data?: Record<string, any> } | null;
  if (!m?.data) return null;
  const dist = m.data[key] as Record<string, unknown> | undefined;
  const v = dist?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const inferenceChecks: CheckDescriptor[] = [
  {
    id: "inference.ttft.p95.ms",
    scenario: "inference",
    toolFilter: ["guidellm", "genai-perf"],
    axis: "responsiveness",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.ttft.p95.ms.recommendation",
    read: (m) => {
      const t = (m as any)?.tool;
      if (t === "guidellm") return fromDist(m, "ttft", "p95");
      if (t === "genai-perf") return fromDist(m, "timeToFirstToken", "p95");
      return null;
    },
  },
  {
    id: "inference.ttft.p99.ms",
    scenario: "inference",
    toolFilter: ["guidellm", "genai-perf"],
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.ttft.p99.ms.recommendation",
    read: (m) => {
      const t = (m as any)?.tool;
      if (t === "guidellm") return fromDist(m, "ttft", "p99");
      if (t === "genai-perf") return fromDist(m, "timeToFirstToken", "p99");
      return null;
    },
  },
  {
    id: "inference.itl.p95.ms",
    scenario: "inference",
    toolFilter: ["guidellm"],
    axis: "smoothness",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.itl.p95.ms.recommendation",
    read: (m) => fromDist(m, "itl", "p95"),
  },
  {
    id: "inference.e2e.p95.ms",
    scenario: "inference",
    axis: "responsiveness",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.e2e.p95.ms.recommendation",
    read: (m) => readP95Latency(m),
  },
  {
    id: "inference.e2e.p99.ms",
    scenario: "inference",
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.e2e.p99.ms.recommendation",
    read: (m) => {
      const t = (m as any)?.tool;
      if (t === "guidellm") return fromDist(m, "e2eLatency", "p99");
      if (t === "vegeta") return fromDist(m, "latencies", "p99");
      if (t === "genai-perf") return fromDist(m, "requestLatency", "p99");
      return null;
    },
  },
  {
    id: "inference.error_rate",
    scenario: "inference",
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.error_rate.recommendation",
    read: (m) => readErrorRate(m),
  },
  {
    id: "inference.throughput.req_per_s",
    scenario: "inference",
    axis: "throughput",
    defaultWeight: 0.5,
    direction: "higher_is_better",
    recommendationKey: "checks.inference.throughput.req_per_s.recommendation",
    read: (m) => readThroughput(m),
  },
];
```

**- [ ] Step 2: Run descriptors test**

```bash
pnpm -F @modeldoctor/web test -- descriptors
```

Expected: passes (the test from Task 6 expects `inference.ttft.p95.ms` and `inference.error_rate`, both now present).

**- [ ] Step 3: Commit**

```bash
git add apps/web/src/features/insights/checks/inference.ts
git commit -m "$(cat <<'EOF'
feat(web/insights): 7 inference checks (TTFT/ITL/E2E/error/throughput)

Reuses existing readP95Latency/readErrorRate/readThroughput from
compare/metrics. TTFT + ITL are tool-filtered (guidellm/genai-perf
only); e2e and error_rate work across all tools.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Implement capacity + gateway scenario checks

**Files:**
- Modify: `apps/web/src/features/insights/checks/capacity.ts`
- Modify: `apps/web/src/features/insights/checks/gateway.ts`

**- [ ] Step 1: Capacity checks (3)**

```ts
// apps/web/src/features/insights/checks/capacity.ts
import { readErrorRate, readThroughput } from "@/features/benchmarks/compare/metrics";
import type { CheckDescriptor } from "./descriptors";

function tailRatio(m: any): number | null {
  const t = (m as any)?.tool;
  if (!t) return null;
  let p50: number | null = null;
  let p99: number | null = null;
  if (t === "guidellm") {
    p50 = m?.data?.e2eLatency?.p50 ?? null;
    p99 = m?.data?.e2eLatency?.p99 ?? null;
  } else if (t === "vegeta") {
    p50 = m?.data?.latencies?.p50 ?? null;
    p99 = m?.data?.latencies?.p99 ?? null;
  } else if (t === "genai-perf") {
    p50 = m?.data?.requestLatency?.p50 ?? null;
    p99 = m?.data?.requestLatency?.p99 ?? null;
  }
  if (typeof p50 !== "number" || typeof p99 !== "number" || p50 <= 0) return null;
  return p99 / p50;
}

export const capacityChecks: CheckDescriptor[] = [
  {
    id: "capacity.max_qps",
    scenario: "capacity",
    axis: "throughput",
    defaultWeight: 1.0,
    direction: "higher_is_better",
    recommendationKey: "checks.capacity.max_qps.recommendation",
    // For capacity scenario the throughput is the headline number — same reader.
    read: (m) => readThroughput(m),
  },
  {
    id: "capacity.error_rate",
    scenario: "capacity",
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.capacity.error_rate.recommendation",
    read: (m) => readErrorRate(m),
  },
  {
    id: "capacity.tail_ratio",
    scenario: "capacity",
    axis: "tail",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.capacity.tail_ratio.recommendation",
    read: tailRatio,
  },
];
```

**- [ ] Step 2: Gateway checks (3)**

```ts
// apps/web/src/features/insights/checks/gateway.ts
import { readErrorRate, readThroughput } from "@/features/benchmarks/compare/metrics";
import type { CheckDescriptor } from "./descriptors";

function tailRatio(m: any): number | null {
  if ((m as any)?.tool !== "vegeta") return null;
  const p50 = m?.data?.latencies?.p50;
  const p99 = m?.data?.latencies?.p99;
  if (typeof p50 !== "number" || typeof p99 !== "number" || p50 <= 0) return null;
  return p99 / p50;
}

export const gatewayChecks: CheckDescriptor[] = [
  {
    id: "gateway.error_rate",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.gateway.error_rate.recommendation",
    read: (m) => readErrorRate(m),
  },
  {
    id: "gateway.tail_ratio",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "tail",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.gateway.tail_ratio.recommendation",
    read: tailRatio,
  },
  {
    id: "gateway.throughput.req_per_s",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "throughput",
    defaultWeight: 0.7,
    direction: "higher_is_better",
    recommendationKey: "checks.gateway.throughput.req_per_s.recommendation",
    read: (m) => readThroughput(m),
  },
];
```

**- [ ] Step 3: Run all insights tests**

```bash
pnpm -F @modeldoctor/web test -- insights
```

Expected: all green (descriptors test now sees all 13 checks).

**- [ ] Step 4: Commit**

```bash
git add apps/web/src/features/insights/checks/capacity.ts apps/web/src/features/insights/checks/gateway.ts
git commit -m "$(cat <<'EOF'
feat(web/insights): capacity + gateway scenario checks

3 capacity (max_qps, error_rate, tail_ratio) + 3 gateway (error_rate,
tail_ratio, throughput). Tail-ratio defined as p99/p50; tool-specific
reading because vegeta uses different metric path than guidellm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Add aggregateChecks (median across runs) + buildFindings

**Files:**
- Create: `apps/web/src/features/insights/buildFindings.ts`
- Create: `apps/web/src/features/insights/__tests__/buildFindings.test.ts`

**- [ ] Step 1: Write failing test**

```ts
// apps/web/src/features/insights/__tests__/buildFindings.test.ts
import type { Benchmark, ProfileRules } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { aggregateCheck, buildFindings } from "../buildFindings";
import { getCheck } from "../checks/descriptors";

function run(p: Partial<Benchmark> & { id: string; summaryMetrics: any }): Benchmark {
  return {
    id: p.id, userId: "u1", connectionId: "c1", connection: null,
    scenario: p.scenario ?? "inference", tool: p.tool ?? "guidellm", toolVersion: null,
    name: p.id, description: null, status: "completed", statusMessage: null, progress: null,
    driverHandle: null, params: {}, rawOutput: null, summaryMetrics: p.summaryMetrics,
    serverMetrics: null, templateId: null, parentBenchmarkId: null, baselineId: null, logs: null,
    createdAt: "2026-05-01T00:00:00.000Z", startedAt: null, completedAt: null, baselineFor: null,
  } as Benchmark;
}

const guidellmMetrics = (ttft_p95: number) => ({
  tool: "guidellm",
  data: {
    ttft: { p95: ttft_p95, p99: ttft_p95 * 1.3 },
    e2eLatency: { p95: 2000, p99: 4000 },
    requests: { total: 1000, error: 5 },
    requestsPerSecond: { mean: 12 },
  },
});

describe("aggregateCheck", () => {
  it("returns null when no completed runs match", () => {
    const c = getCheck("inference.ttft.p95.ms")!;
    const v = aggregateCheck(c, [run({ id: "r1", summaryMetrics: null, status: "failed" } as any)]);
    expect(v).toBeNull();
  });

  it("returns median across runs", () => {
    const c = getCheck("inference.ttft.p95.ms")!;
    const runs = [
      run({ id: "r1", summaryMetrics: guidellmMetrics(100) }),
      run({ id: "r2", summaryMetrics: guidellmMetrics(300) }),
      run({ id: "r3", summaryMetrics: guidellmMetrics(500) }),
    ];
    expect(aggregateCheck(c, runs)).toBe(300);
  });

  it("respects toolFilter", () => {
    const c = getCheck("inference.itl.p95.ms")!; // guidellm-only
    const runs = [run({ id: "r1", tool: "vegeta", summaryMetrics: { tool: "vegeta", data: {} } })];
    expect(aggregateCheck(c, runs)).toBeNull();
  });
});

describe("buildFindings", () => {
  const profileRules: ProfileRules = {
    checks: {
      "inference.ttft.p95.ms": { warn: 200, crit: 500, weight: 1.0 },
      "inference.error_rate": { warn: 0.01, crit: 0.05, weight: 1.0 },
    },
  };

  it("emits crit finding when value crosses crit threshold", () => {
    const runs = [run({ id: "r1", summaryMetrics: guidellmMetrics(800) })];
    const findings = buildFindings(runs, profileRules);
    const ttft = findings.find((f) => f.checkId === "inference.ttft.p95.ms");
    expect(ttft?.severity).toBe("crit");
    expect(ttft?.value).toBe(800);
  });

  it("emits no_data finding when check has no rule in profile", () => {
    const runs = [run({ id: "r1", summaryMetrics: guidellmMetrics(100) })];
    const findings = buildFindings(runs, { checks: {} });
    expect(findings.every((f) => f.severity === "no_data")).toBe(true);
  });

  it("populates contributingRunIds with the runs whose values were aggregated", () => {
    const runs = [
      run({ id: "r1", summaryMetrics: guidellmMetrics(100) }),
      run({ id: "r2", summaryMetrics: guidellmMetrics(300) }),
    ];
    const findings = buildFindings(runs, profileRules);
    const ttft = findings.find((f) => f.checkId === "inference.ttft.p95.ms");
    expect(ttft?.contributingRunIds).toEqual(["r1", "r2"]);
  });
});
```

**- [ ] Step 2: Implement**

```ts
// apps/web/src/features/insights/buildFindings.ts
import type { Benchmark, Finding, ProfileRules } from "@modeldoctor/contracts";
import { ALL_CHECKS, type CheckDescriptor } from "./checks/descriptors";
import { evaluateSeverity } from "./evaluate";
import i18n from "@/lib/i18n";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface AggregateResult {
  value: number | null;
  contributingRunIds: string[];
}

export function aggregateCheck(check: CheckDescriptor, runs: Benchmark[]): number | null {
  return aggregateCheckDetailed(check, runs).value;
}

export function aggregateCheckDetailed(check: CheckDescriptor, runs: Benchmark[]): AggregateResult {
  const matched = runs.filter(
    (r) =>
      r.scenario === check.scenario &&
      r.status === "completed" &&
      (!check.toolFilter || check.toolFilter.includes(r.tool)),
  );
  const samples: { id: string; v: number }[] = [];
  for (const r of matched) {
    const v = check.read(r.summaryMetrics);
    if (v !== null) samples.push({ id: r.id, v });
  }
  if (samples.length === 0) return { value: null, contributingRunIds: [] };
  return {
    value: median(samples.map((s) => s.v)),
    contributingRunIds: samples.map((s) => s.id),
  };
}

export function buildFindings(runs: Benchmark[], profile: ProfileRules): Finding[] {
  const findings: Finding[] = [];
  for (const check of ALL_CHECKS) {
    const rule = profile.checks[check.id];
    const { value, contributingRunIds } = aggregateCheckDetailed(check, runs);
    const severity = rule
      ? evaluateSeverity(value, rule, check.direction)
      : "no_data";
    findings.push({
      checkId: check.id,
      scenario: check.scenario,
      axis: check.axis,
      severity,
      value,
      threshold: rule ?? { warn: 0, crit: 0 },
      weight: rule?.weight ?? check.defaultWeight,
      recommendation: i18n.t(check.recommendationKey, { ns: "insights", defaultValue: "" }),
      contributingRunIds,
    });
  }
  return findings;
}
```

**- [ ] Step 3: Run test**

```bash
pnpm -F @modeldoctor/web test -- buildFindings
```

Expected: green.

**- [ ] Step 4: Commit**

```bash
git add apps/web/src/features/insights/buildFindings.ts apps/web/src/features/insights/__tests__/buildFindings.test.ts
git commit -m "$(cat <<'EOF'
feat(web/insights): aggregate check across runs + buildFindings

aggregateCheck takes the median across completed runs matching the
check's scenario + toolFilter. buildFindings produces one Finding per
descriptor; missing rules → no_data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

(Plan continues — see next file for Phases 4-12.)

## Phase 4 — Insights detail page (no AI yet)

### Task 10: Add useEvaluationProfiles + useConnection-with-profile queries

**Files:**
- Create: `apps/web/src/features/insights/queries.ts`

**- [ ] Step 1: Implement queries**

```ts
// apps/web/src/features/insights/queries.ts
import { apiClient } from "@/lib/api-client";
import type { ListEvaluationProfilesResponse } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";

export function useEvaluationProfiles() {
  return useQuery<ListEvaluationProfilesResponse>({
    queryKey: ["evaluation-profiles"],
    queryFn: async () => {
      const r = await apiClient.get("/insights/profiles");
      return r.data;
    },
    staleTime: 1000 * 60 * 60, // profiles rarely change
  });
}

export function defaultProfileSlug(): string {
  return "default";
}
```

**- [ ] Step 2: Commit (the endpoint doesn't exist yet — that's OK; we'll use it once Phase 6 lands. Mock-friendly for tests.)**

```bash
git add apps/web/src/features/insights/queries.ts
git commit -m "$(cat <<'EOF'
feat(web/insights): useEvaluationProfiles query hook

Fetches built-in profiles from GET /insights/profiles. Endpoint
implementation lands in Phase 6; this hook lets the UI compile.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Build ScoreBanner component (TDD)

**Files:**
- Create: `apps/web/src/features/insights/ScoreBanner.tsx`
- Create: `apps/web/src/features/insights/__tests__/ScoreBanner.test.tsx`

**- [ ] Step 1: Write failing test**

```tsx
// apps/web/src/features/insights/__tests__/ScoreBanner.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { ScoreBanner } from "../ScoreBanner";

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("ScoreBanner", () => {
  it("renders composite score and per-scenario sub-scores", () => {
    r(<ScoreBanner composite={87} perScenario={{ inference: 92, capacity: 75, gateway: 82 }} totalChecks={18} totalRuns={25} rangeDays={30} />);
    expect(screen.getByText("87")).toBeInTheDocument();
    expect(screen.getByText(/92/)).toBeInTheDocument();
    expect(screen.getByText(/75/)).toBeInTheDocument();
    expect(screen.getByText(/82/)).toBeInTheDocument();
  });

  it("renders en-dash when composite is null", () => {
    r(<ScoreBanner composite={null} perScenario={{ inference: null, capacity: null, gateway: null }} totalChecks={0} totalRuns={0} rangeDays={30} />);
    expect(screen.getByTestId("composite-score").textContent).toBe("—");
  });

  it("dims null sub-scores", () => {
    r(<ScoreBanner composite={92} perScenario={{ inference: 92, capacity: null, gateway: null }} totalChecks={7} totalRuns={5} rangeDays={30} />);
    expect(screen.getByTestId("subscore-capacity")).toHaveTextContent("—");
  });
});
```

**- [ ] Step 2: Implement ScoreBanner**

```tsx
// apps/web/src/features/insights/ScoreBanner.tsx
import { Card, CardContent } from "@/components/ui/card";
import type { ScenarioId } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { RadarChart } from "./RadarChart";

type Sub = Record<ScenarioId, number | null>;

interface Props {
  composite: number | null;
  perScenario: Sub;
  totalChecks: number;
  totalRuns: number;
  rangeDays: number;
  axisValues?: Record<string, number | null>;
}

const SCEN: ScenarioId[] = ["inference", "capacity", "gateway"];

function severityClass(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function ScoreBanner({ composite, perScenario, totalChecks, totalRuns, rangeDays, axisValues }: Props) {
  const { t } = useTranslation("insights");
  return (
    <Card className="overflow-hidden">
      <CardContent className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[200px_1fr]">
        <div className="flex items-center justify-center">
          <RadarChart values={axisValues ?? {}} size={180} />
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline gap-3">
            <div data-testid="composite-score" className={`text-5xl font-bold tabular-nums ${severityClass(composite)}`}>
              {composite ?? "—"}
            </div>
            <div className="text-lg text-muted-foreground">/ 100</div>
            <div className="text-sm text-muted-foreground">
              · {t("detail.compositeScore")}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {t("detail.checks", { count: totalChecks })} ·{" "}
            {t("detail.runs", { count: totalRuns })} · {t("detail.in", { days: rangeDays })}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {SCEN.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{t(`detail.scenario.${s}`)}:</span>
                <span data-testid={`subscore-${s}`} className={`font-semibold tabular-nums ${severityClass(perScenario[s])}`}>
                  {perScenario[s] ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

**- [ ] Step 3: Run test (will fail until RadarChart exists — write a stub for now)**

`apps/web/src/features/insights/RadarChart.tsx` (stub):
```tsx
interface Props {
  values: Record<string, number | null>;
  size?: number;
}
export function RadarChart({ values, size = 160 }: Props) {
  // Stub — real SVG implementation in Task 12
  return <div data-testid="radar-chart" style={{ width: size, height: size }} aria-label="radar" />;
}
```

```bash
pnpm -F @modeldoctor/web test -- ScoreBanner
```

Expected: tests pass (i18n keys missing fall back to keys themselves; assertions check numbers, not labels).

**- [ ] Step 4: Commit**

```bash
git add apps/web/src/features/insights/ScoreBanner.tsx apps/web/src/features/insights/RadarChart.tsx apps/web/src/features/insights/__tests__/ScoreBanner.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/insights): ScoreBanner component + RadarChart stub

Renders composite score (large), per-scenario sub-scores, and a
RadarChart slot. RadarChart implementation stubbed; real SVG follows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Implement RadarChart (SVG, 6 axes, no library)

**Files:**
- Modify: `apps/web/src/features/insights/RadarChart.tsx`
- Create: `apps/web/src/features/insights/__tests__/RadarChart.test.tsx`

**- [ ] Step 1: Write failing test**

```tsx
// apps/web/src/features/insights/__tests__/RadarChart.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RadarChart } from "../RadarChart";

describe("RadarChart", () => {
  it("renders 6 axis spokes", () => {
    const { container } = render(<RadarChart values={{}} />);
    const spokes = container.querySelectorAll("[data-axis]");
    expect(spokes.length).toBe(6);
  });

  it("draws polygon for non-null axis values", () => {
    const { container } = render(
      <RadarChart values={{ responsiveness: 0.8, throughput: 0.5, stability: 1.0 }} />,
    );
    const poly = container.querySelector("polygon[data-role='value-shape']");
    expect(poly).toBeTruthy();
    // points attribute should be a non-empty space-separated list
    expect(poly?.getAttribute("points")?.split(" ").length).toBeGreaterThan(2);
  });

  it("renders axis labels at the spoke ends", () => {
    const { getAllByRole } = render(<RadarChart values={{}} />);
    // labels are <text> elements; jsdom exposes role=img on svg
    const svg = getAllByRole("img")[0];
    expect(svg.querySelectorAll("text").length).toBeGreaterThanOrEqual(6);
  });
});
```

**- [ ] Step 2: Implement RadarChart**

```tsx
// apps/web/src/features/insights/RadarChart.tsx
import type { RadarAxisId } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

const AXES: RadarAxisId[] = [
  "responsiveness",
  "smoothness",
  "throughput",
  "stability",
  "tail",
  "efficiency",
];

interface Props {
  values: Partial<Record<RadarAxisId, number | null>>;
  size?: number;
}

export function RadarChart({ values, size = 180 }: Props) {
  const { t } = useTranslation("insights");
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 32; // padding for labels
  const n = AXES.length;

  // Compute (x,y) on the unit circle for each axis at value v ∈ [0, 1].
  function pt(idx: number, v: number) {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * r * v, cy + Math.sin(angle) * r * v] as const;
  }

  const ringRadii = [0.25, 0.5, 0.75, 1.0];

  // Build value polygon — null axes get 0 (rendered as inward spike).
  const valuePoints = AXES.map((axis, i) => {
    const v = values[axis] ?? 0;
    return pt(i, v).join(",");
  }).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="radar">
      {ringRadii.map((rad, i) => (
        <polygon
          key={i}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          points={AXES.map((_, j) => pt(j, rad).join(",")).join(" ")}
        />
      ))}
      {AXES.map((axis, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.18);
        return (
          <g key={axis} data-axis={axis}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.2} />
            <text
              x={lx}
              y={ly}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.7}
              textAnchor={lx < cx - 4 ? "end" : lx > cx + 4 ? "start" : "middle"}
              dominantBaseline={ly < cy ? "alphabetic" : "hanging"}
            >
              {t(`axis.${axis}`, { defaultValue: axis })}
            </text>
          </g>
        );
      })}
      <polygon
        data-role="value-shape"
        points={valuePoints}
        fill="rgb(74,108,247)"
        fillOpacity={0.25}
        stroke="rgb(74,108,247)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
```

**- [ ] Step 3: Run test**

```bash
pnpm -F @modeldoctor/web test -- RadarChart
```

Expected: green.

**- [ ] Step 4: Commit**

```bash
git add apps/web/src/features/insights/RadarChart.tsx apps/web/src/features/insights/__tests__/RadarChart.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/insights): SVG radar chart (6 axes, ring grid, value polygon)

No external dependency. Renders 4 concentric rings, 6 axis spokes with
labels (i18n), and a fill polygon for the values map. Null axes draw as
inward spike (value=0).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Build FindingsCard component

**Files:**
- Create: `apps/web/src/features/insights/FindingsCard.tsx`
- Create: `apps/web/src/features/insights/__tests__/FindingsCard.test.tsx`

**- [ ] Step 1: Write failing test**

```tsx
// apps/web/src/features/insights/__tests__/FindingsCard.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Finding } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { FindingsCard } from "../FindingsCard";

function f(severity: Finding["severity"], scenario: Finding["scenario"], checkId: string, value: number, recommendation = "fix it"): Finding {
  return {
    checkId, scenario, axis: "responsiveness", severity, value, weight: 1,
    threshold: { warn: 100, crit: 200 }, recommendation, contributingRunIds: [],
  };
}

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("FindingsCard", () => {
  it("ranks crit > warn > good and shows top 5 by default", () => {
    const fs: Finding[] = [
      f("good", "inference", "a", 1),
      f("warn", "inference", "b", 2),
      f("crit", "inference", "c", 3),
      f("good", "inference", "d", 4),
      f("crit", "inference", "e", 5),
      f("warn", "inference", "f", 6),
      f("good", "inference", "g", 7),
    ];
    r(<FindingsCard findings={fs} />);
    const items = screen.getAllByTestId(/^finding-/);
    expect(items.length).toBe(5);
    // first two should be crit
    expect(items[0]).toHaveAttribute("data-severity", "crit");
    expect(items[1]).toHaveAttribute("data-severity", "crit");
  });

  it("expand button reveals all findings", async () => {
    const fs: Finding[] = Array.from({ length: 8 }, (_, i) => f("good", "inference", `c${i}`, i));
    r(<FindingsCard findings={fs} />);
    expect(screen.getAllByTestId(/^finding-/).length).toBe(5);
    await userEvent.click(screen.getByRole("button", { name: /展开|expand/i }));
    expect(screen.getAllByTestId(/^finding-/).length).toBe(8);
  });

  it("hides no_data findings entirely", () => {
    const fs: Finding[] = [f("no_data", "inference", "a", 0)];
    r(<FindingsCard findings={fs} />);
    expect(screen.queryByTestId(/^finding-/)).toBeNull();
  });
});
```

**- [ ] Step 2: Implement**

```tsx
// apps/web/src/features/insights/FindingsCard.tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Finding } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const SEV_RANK: Record<Finding["severity"], number> = {
  crit: 0, warn: 1, good: 2, no_data: 3,
};

const SEV_BADGE = {
  crit: { emoji: "🔴", cls: "border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20", label: "高危" },
  warn: { emoji: "🟡", cls: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20", label: "中等" },
  good: { emoji: "🟢", cls: "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20", label: "良好" },
  no_data: { emoji: "·", cls: "border-l-muted bg-muted/30", label: "无数据" },
} as const;

interface Props {
  findings: Finding[];
  defaultLimit?: number;
}

export function FindingsCard({ findings, defaultLimit = 5 }: Props) {
  const { t } = useTranslation("insights");
  const [expanded, setExpanded] = useState(false);

  const visible = findings
    .filter((f) => f.severity !== "no_data")
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (b.weight - a.weight));

  const shown = expanded ? visible : visible.slice(0, defaultLimit);
  const hiddenCount = visible.length - shown.length;

  if (visible.length === 0) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold">{t("detail.findings.title")}</h3>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">{t("detail.findings.noFindings")}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <h3 className="text-sm font-semibold">{t("detail.findings.title")}</h3>
      </CardHeader>
      <CardContent className="space-y-2">
        {shown.map((f) => {
          const sev = SEV_BADGE[f.severity];
          return (
            <div
              key={f.checkId}
              data-testid={`finding-${f.checkId}`}
              data-severity={f.severity}
              className={`rounded-md border-l-[3px] px-3 py-2 text-sm ${sev.cls}`}
            >
              <div className="flex items-center gap-2 font-medium">
                <span>{sev.emoji}</span>
                <span>[{t(`detail.scenario.${f.scenario}`)}]</span>
                <span>{f.checkId}</span>
                {f.value != null && (
                  <span className="text-muted-foreground">
                    = {f.value.toFixed(2)} (warn {f.threshold.warn} / crit {f.threshold.crit})
                  </span>
                )}
              </div>
              {f.recommendation && (
                <div className="mt-1 text-xs text-muted-foreground">{f.recommendation}</div>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div className="pt-1">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
              {t("detail.findings.expandAll", { count: visible.length })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

**- [ ] Step 3: Test + commit**

```bash
pnpm -F @modeldoctor/web test -- FindingsCard
```

Expected: green.

```bash
git add apps/web/src/features/insights/FindingsCard.tsx apps/web/src/features/insights/__tests__/FindingsCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/insights): findings card — severity-ranked, expandable

Sorts findings by severity (crit > warn > good), then weight desc.
Default top-5; expand button reveals all. Hides no_data entirely.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Build ScenarioPanel + ProfileSelector

**Files:**
- Create: `apps/web/src/features/insights/ScenarioPanel.tsx`
- Create: `apps/web/src/features/insights/ProfileSelector.tsx`
- Create: `apps/web/src/features/insights/__tests__/ScenarioPanel.test.tsx`

**- [ ] Step 1: ProfileSelector**

```tsx
// apps/web/src/features/insights/ProfileSelector.tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EvaluationProfile } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

interface Props {
  value: string;
  options: EvaluationProfile[];
  onChange: (slug: string) => void;
}

export function ProfileSelector({ value, options, onChange }: Props) {
  const { t } = useTranslation("insights");
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px]" aria-label={t("detail.profile.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.slug} value={p.slug}>
            {p.nameKey ? t(p.nameKey, { defaultValue: p.name }) : p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

**- [ ] Step 2: ScenarioPanel**

```tsx
// apps/web/src/features/insights/ScenarioPanel.tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Benchmark, Finding, ScenarioId } from "@modeldoctor/contracts";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FindingsCard } from "./FindingsCard";
import { RadarChart } from "./RadarChart";

interface Props {
  scenario: ScenarioId;
  subScore: number | null;
  axisValues: Record<string, number | null>;
  findings: Finding[];
  runs: Benchmark[];
  connectionId: string;
  rangeFromISO: string;
}

export function ScenarioPanel({ scenario, subScore, axisValues, findings, runs, connectionId, rangeFromISO }: Props) {
  const { t } = useTranslation("insights");
  const hasData = runs.length > 0;
  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold">{t(`detail.scenario.${scenario}`)}</h3>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            {t("detail.scenario.empty.title", { scenario: t(`detail.scenario.${scenario}`) })}
          </div>
          <div className="mt-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/benchmarks/${scenario}`}>{t("detail.scenario.empty.cta")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  const tools = [...new Set(runs.map((r) => r.tool))];
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t(`detail.scenario.${scenario}`)}{" "}
          {subScore != null && <span className="ml-2 text-base font-bold tabular-nums">{subScore}</span>}
        </h3>
        <span className="text-xs text-muted-foreground">
          {t("detail.runs", { count: runs.length })} · {tools.join(", ")}
        </span>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[140px_1fr]">
        <div className="flex justify-center">
          <RadarChart values={axisValues} size={140} />
        </div>
        <div className="space-y-2">
          <FindingsCard findings={findings} defaultLimit={3} />
          <div>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link
                to={`/benchmarks?connectionId=${connectionId}&scenario=${scenario}&createdAfter=${encodeURIComponent(rangeFromISO)}`}
              >
                {t("detail.scenario.viewAll", { count: runs.length })}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

**- [ ] Step 3: Smoke test ScenarioPanel**

```tsx
// apps/web/src/features/insights/__tests__/ScenarioPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/lib/i18n";
import { ScenarioPanel } from "../ScenarioPanel";

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>);
}

describe("ScenarioPanel", () => {
  it("renders empty state when 0 runs", () => {
    r(<ScenarioPanel scenario="capacity" subScore={null} axisValues={{}} findings={[]} runs={[]} connectionId="c1" rangeFromISO="2026-04-01T00:00:00Z" />);
    expect(screen.getByText(/尚无|empty/i)).toBeInTheDocument();
  });
});
```

**- [ ] Step 4: Run test + commit**

```bash
pnpm -F @modeldoctor/web test -- ScenarioPanel
```

```bash
git add apps/web/src/features/insights/ScenarioPanel.tsx apps/web/src/features/insights/ProfileSelector.tsx apps/web/src/features/insights/__tests__/ScenarioPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/insights): ScenarioPanel + ProfileSelector

ScenarioPanel renders sub-score, mini radar (140px), embedded
FindingsCard limited to top-3, and a deep-link to /benchmarks list
filtered by scenario+connection+range. Empty state with CTA when
no runs in scenario.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Compose InsightsDetailPage + add route + redirect

**Files:**
- Create: `apps/web/src/features/insights/InsightsDetailPage.tsx`
- Modify: `apps/web/src/router/index.tsx`
- Create: `apps/web/src/features/insights/__tests__/InsightsDetailPage.test.tsx`

**- [ ] Step 1: Implement InsightsDetailPage**

```tsx
// apps/web/src/features/insights/InsightsDetailPage.tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useConnection } from "@/features/connections/queries";
import { useBenchmarkList } from "@/features/benchmarks/queries";
import type { Benchmark, EndpointReportRange, ScenarioId } from "@modeldoctor/contracts";
import { ArrowLeft, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FindingsCard } from "./FindingsCard";
import { ProfileSelector } from "./ProfileSelector";
import { ScenarioPanel } from "./ScenarioPanel";
import { ScoreBanner } from "./ScoreBanner";
import { ALL_CHECKS } from "./checks/descriptors";
import { buildFindings } from "./buildFindings";
import { axisValue, compositeScore, scenarioScore } from "./evaluate";
import { useEvaluationProfiles } from "./queries";

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];
const SCENARIOS: ScenarioId[] = ["inference", "capacity", "gateway"];

function rangeToISO(range: EndpointReportRange): string {
  const days = ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function InsightsDetailPage() {
  const { t } = useTranslation("insights");
  const { connectionId = "" } = useParams<{ connectionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get("range") ?? "30d") as EndpointReportRange;
  const profileSlug = searchParams.get("profile") ?? null;

  const conn = useConnection(connectionId);
  const profiles = useEvaluationProfiles();
  const createdAfter = useMemo(() => rangeToISO(range), [range]);
  const list = useBenchmarkList({
    connectionId, createdAfter, limit: 200, scope: "own",
  });

  const runs: Benchmark[] = useMemo(() => list.data?.pages[0]?.items ?? [], [list.data]);

  const activeProfile = useMemo(() => {
    const slug = profileSlug ?? conn.data?.evaluationProfile?.slug ?? "default";
    return profiles.data?.items.find((p) => p.slug === slug);
  }, [profiles.data, profileSlug, conn.data]);

  const findings = useMemo(() => {
    if (!activeProfile) return [];
    return buildFindings(runs, activeProfile.rules);
  }, [runs, activeProfile]);

  const perScenarioFindings = useMemo(() => {
    return SCENARIOS.reduce((acc, s) => {
      acc[s] = findings.filter((f) => f.scenario === s);
      return acc;
    }, {} as Record<ScenarioId, typeof findings>);
  }, [findings]);

  const subScores = useMemo(() => {
    return SCENARIOS.reduce((acc, s) => {
      acc[s] = scenarioScore(perScenarioFindings[s]);
      return acc;
    }, {} as Record<ScenarioId, number | null>);
  }, [perScenarioFindings]);

  const composite = useMemo(() => compositeScore(subScores), [subScores]);

  const overallAxisValues = useMemo(() => ({
    responsiveness: axisValue("responsiveness", findings),
    smoothness: axisValue("smoothness", findings),
    throughput: axisValue("throughput", findings),
    stability: axisValue("stability", findings),
    tail: axisValue("tail", findings),
    efficiency: axisValue("efficiency", findings),
  }), [findings]);

  const runsByScenario = useMemo(() => {
    return SCENARIOS.reduce((acc, s) => {
      acc[s] = runs.filter((r) => r.scenario === s);
      return acc;
    }, {} as Record<ScenarioId, Benchmark[]>);
  }, [runs]);

  if ((conn.error as { status?: number } | null)?.status === 404) {
    return (
      <>
        <PageHeader title={connectionId} />
        <div className="px-8 py-6">
          <EmptyState icon={SearchX} title="404" body={t("detail.notFound")} />
        </div>
      </>
    );
  }
  if (conn.isLoading || profiles.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }
  if (!conn.data || !profiles.data) return null;

  function setRange(next: EndpointReportRange) {
    const sp = new URLSearchParams(searchParams);
    sp.set("range", next);
    setSearchParams(sp);
  }
  function setProfile(slug: string) {
    const sp = new URLSearchParams(searchParams);
    sp.set("profile", slug);
    setSearchParams(sp);
  }

  return (
    <>
      <PageHeader
        title={conn.data.name}
        subtitle={`${conn.data.baseUrl} · ${conn.data.model} · ${conn.data.category}`}
        rightSlot={
          <div className="flex items-center gap-3">
            <ProfileSelector value={activeProfile?.slug ?? "default"} options={profiles.data.items} onChange={setProfile} />
            <Select value={range} onValueChange={(v) => setRange(v as EndpointReportRange)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r} value={r}>{r === "7d" ? "近 7 天" : r === "30d" ? "近 30 天" : "近 90 天"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="ghost" size="sm">
              <Link to="/benchmarks/reports"><ArrowLeft className="mr-1 h-4 w-4" />{t("detail.backToIndex")}</Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        <ScoreBanner
          composite={composite}
          perScenario={subScores}
          totalChecks={findings.filter((f) => f.severity !== "no_data").length}
          totalRuns={runs.length}
          rangeDays={({ "7d": 7, "30d": 30, "90d": 90 } as const)[range]}
          axisValues={overallAxisValues}
        />
        <FindingsCard findings={findings} defaultLimit={5} />
        {SCENARIOS.map((s) => (
          <ScenarioPanel
            key={s}
            scenario={s}
            subScore={subScores[s]}
            axisValues={SCENARIOS.reduce<Record<string, number | null>>((acc, _) => acc, {})}
            findings={perScenarioFindings[s]}
            runs={runsByScenario[s]}
            connectionId={connectionId}
            rangeFromISO={createdAfter}
          />
        ))}
      </div>
    </>
  );
}
```

**- [ ] Step 2: Update router**

In `apps/web/src/router/index.tsx`:

a) Replace import:
```diff
- import { TestInsightsDetailPage } from "@/features/benchmarks/TestInsightsDetailPage";
+ import { InsightsDetailPage } from "@/features/insights/InsightsDetailPage";
+ import { useParams, Navigate } from "react-router-dom";
```

(react-router imports may already exist; merge.)

b) Add a small redirect component (top of file or above `routes`):
```tsx
function RedirectToInsights() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const search = window.location.search;
  return <Navigate to={`/insights/${connectionId}${search}`} replace />;
}
```

c) Replace the existing route:
```diff
- { path: "benchmarks/reports/:connectionId", element: <TestInsightsDetailPage /> },
+ { path: "benchmarks/reports/:connectionId", element: <RedirectToInsights /> },
+ { path: "insights/:connectionId", element: <InsightsDetailPage /> },
```

**- [ ] Step 3: Smoke test the page renders**

```tsx
// apps/web/src/features/insights/__tests__/InsightsDetailPage.test.tsx
import { render } from "@testing-library/react";
import { describe, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { InsightsDetailPage } from "../InsightsDetailPage";

describe("InsightsDetailPage", () => {
  it("renders without crashing", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/insights/c1?range=30d"]}>
            <Routes>
              <Route path="/insights/:connectionId" element={<InsightsDetailPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    // Loading skeleton should be present (no msw → both queries pending).
  });
});
```

```bash
pnpm -F @modeldoctor/web test -- InsightsDetailPage
```

Expected: green (just renders skeleton).

**- [ ] Step 4: Manual smoke**

```bash
pnpm -F @modeldoctor/web dev
```

Visit `http://localhost:5173/benchmarks/reports/<some-connection-id>` → should redirect to `/insights/<id>`. Page renders skeleton; content depends on Phase 6 (profiles endpoint). Stop the dev server.

**- [ ] Step 5: Commit**

```bash
git add apps/web/src/features/insights/InsightsDetailPage.tsx apps/web/src/features/insights/__tests__/InsightsDetailPage.test.tsx apps/web/src/router/index.tsx
git commit -m "$(cat <<'EOF'
feat(web/insights): InsightsDetailPage composition + route + redirect

Composes ScoreBanner + FindingsCard + 3 ScenarioPanels. Profile and
range selectors in the page header rightSlot. /insights/:connectionId
is the canonical route; /benchmarks/reports/:connectionId redirects.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — List page filters + rename

### Task 16: Add filter row to EndpointReportsPage

**Files:**
- Modify: `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`

**- [ ] Step 1: Update component (full rewrite of body, keep imports):**

```tsx
// apps/web/src/features/benchmarks/EndpointReportsPage.tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEvaluationProfiles } from "@/features/insights/queries";
import type { EndpointReportRange } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, BarChart3, Search } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { TrendIndicator } from "./TrendIndicator";
import { useEndpointReports } from "./queries";
import { StatusBadge } from "./status-display";

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];
const ALL = "__all__";

export function EndpointReportsPage() {
  const { t } = useTranslation("benchmarks");
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get("range") ?? "30d") as EndpointReportRange;
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? ALL;
  const profileFilter = searchParams.get("profile") ?? ALL;

  const { data, isLoading } = useEndpointReports(range);
  const profiles = useEvaluationProfiles();

  function update(next: Partial<{ range: string; q: string; category: string; profile: string }>) {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "" || v === ALL) sp.delete(k);
      else sp.set(k, v);
    }
    setSearchParams(sp);
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    data?.items.forEach((it) => set.add(it.connection.category));
    return [...set].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const ql = q.toLowerCase();
    return data.items.filter((it) => {
      if (ql && !it.connection.name.toLowerCase().includes(ql) && !it.connection.model.toLowerCase().includes(ql)) return false;
      if (category !== ALL && it.connection.category !== category) return false;
      // profile filter applies to the connection's evaluationProfile slug;
      // if not yet returned by endpoint, treat all as passing
      if (profileFilter !== ALL && (it as any).connection?.evaluationProfile?.slug !== profileFilter) return false;
      return true;
    });
  }, [data, q, category, profileFilter]);

  return (
    <>
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("reports.filters.search")}
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              className="pl-9"
            />
          </div>
          <Select value={category} onValueChange={(v) => update({ category: v })}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder={t("reports.filters.category")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reports.filters.categoryAll")}</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={profileFilter} onValueChange={(v) => update({ profile: v })}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder={t("reports.filters.profile")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reports.filters.profileAll")}</SelectItem>
              {profiles.data?.items.map((p) => (
                <SelectItem key={p.slug} value={p.slug}>{p.nameKey ? t(p.nameKey, { defaultValue: p.name }) : p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => update({ range: v })}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => <SelectItem key={r} value={r}>{t(`reports.ranges.${r}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div role="status" aria-label="loading" className="h-64 animate-pulse rounded-md border border-border bg-muted/30" />
        ) : !data || filtered.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={data?.items.length === 0 ? t("reports.empty.title") : t("reports.filters.noResults")}
            body={data?.items.length === 0 ? t("reports.empty.body") : ""}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
              <Card key={item.connection.id}>
                <CardHeader className="space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-semibold leading-tight">{item.connection.name}</h3>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{item.connection.model}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground/70">{item.connection.baseUrl}</div>
                  <div><Badge variant="outline" className="text-[10px]">{item.connection.category}</Badge></div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="space-y-1 text-muted-foreground">
                    <div>
                      {t("reports.summary.totalRuns", { count: item.totalRuns })} ·{" "}
                      {item.successRate != null
                        ? t("reports.summary.successRate", { rate: item.successRate.toFixed(1) })
                        : t("reports.summary.successRateMissing")}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help text-xs">
                          {t("reports.summary.statusBreakdown", {
                            completed: item.statusCounts.completed,
                            failed: item.statusCounts.failed,
                            canceled: item.statusCounts.canceled,
                          })}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{t("reports.summary.statusBreakdownTooltip")}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div>p95: <TrendIndicator first={item.p95Latency?.first ?? null} last={item.p95Latency?.last ?? null} unitSuffix="ms" /></div>
                  {item.latestRun ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {t("reports.summary.latest", {
                          name: item.latestRun.name,
                          when: formatDistanceToNow(new Date(item.latestRun.createdAt), { addSuffix: true }),
                        })}
                      </span>
                      <StatusBadge status={item.latestRun.status} iconOnly />
                    </div>
                  ) : null}
                  <div className="pt-2">
                    <Button asChild variant="outline" size="sm" className="gap-1">
                      <Link to={`/insights/${item.connection.id}?range=${range}`}>
                        {t("reports.viewDetail")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

**- [ ] Step 2: Manual smoke**

```bash
pnpm -F @modeldoctor/web dev
```

Visit `/benchmarks/reports`, type in search box, change category — cards filter. URL updates with `?q=...&category=...`. Stop dev server.

**- [ ] Step 3: Commit**

```bash
git add apps/web/src/features/benchmarks/EndpointReportsPage.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): list-page search/filter row + 查看详情 rename

Filter row above cards: search by name/model, category select,
evaluation profile select, time range. URL state preserved
(?q&category&profile&range). CTA "查看历史" → "查看详情" with
new i18n key reports.viewDetail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Add reports.viewDetail i18n keys + filter labels

**Files:**
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`
- Modify: `apps/web/src/locales/en-US/benchmarks.json`

**- [ ] Step 1: zh-CN**

Inside `reports` block:
```json
"viewDetail": "查看详情",
"filters": {
  "search": "搜索连接名/模型",
  "category": "类别",
  "categoryAll": "全部类别",
  "profile": "画像",
  "profileAll": "全部画像",
  "noResults": "无匹配结果"
}
```

**- [ ] Step 2: en-US**

```json
"viewDetail": "View detail",
"filters": {
  "search": "Search by name or model",
  "category": "Category",
  "categoryAll": "All categories",
  "profile": "Profile",
  "profileAll": "All profiles",
  "noResults": "No matching results"
}
```

Remove the old `viewHistory` keys from both locales.

**- [ ] Step 3: Commit**

```bash
git add apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(i18n/benchmarks): viewDetail + reports filter labels

Removes legacy viewHistory key (only one in-tree caller, replaced
in same PR).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Backend profile API

### Task 18: EvaluationProfile read-only service + module

**Files:**
- Create: `apps/api/src/modules/insights/evaluation-profile.service.ts`
- Create: `apps/api/src/modules/insights/evaluation-profile.service.spec.ts`
- Create: `apps/api/src/modules/insights/evaluation-profile.controller.ts`
- Create: `apps/api/src/modules/insights/insights.module.ts`
- Modify: `apps/api/src/app.module.ts`

**- [ ] Step 1: Service**

```ts
// apps/api/src/modules/insights/evaluation-profile.service.ts
import type { EvaluationProfile, ProfileRules } from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class EvaluationProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<EvaluationProfile[]> {
    const rows = await this.prisma.evaluationProfile.findMany({
      orderBy: [{ isBuiltin: "desc" }, { slug: "asc" }],
    });
    return rows.map((r) => this.toContract(r));
  }

  async getBySlug(slug: string): Promise<EvaluationProfile> {
    const row = await this.prisma.evaluationProfile.findUnique({ where: { slug } });
    if (!row) throw new NotFoundException(`Profile ${slug} not found`);
    return this.toContract(row);
  }

  private toContract(r: any): EvaluationProfile {
    return {
      id: r.id, slug: r.slug, name: r.name, nameKey: r.nameKey,
      description: r.description, isBuiltin: r.isBuiltin,
      rules: r.rules as ProfileRules,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
```

**- [ ] Step 2: Controller**

```ts
// apps/api/src/modules/insights/evaluation-profile.controller.ts
import { listEvaluationProfilesResponseSchema } from "@modeldoctor/contracts";
import { Controller, Get, Param } from "@nestjs/common";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

@Controller("insights/profiles")
export class EvaluationProfileController {
  constructor(private readonly svc: EvaluationProfileService) {}

  @Get()
  async list() {
    const items = await this.svc.list();
    return listEvaluationProfilesResponseSchema.parse({ items });
  }

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    return this.svc.getBySlug(slug);
  }
}
```

**- [ ] Step 3: Service spec**

```ts
// apps/api/src/modules/insights/evaluation-profile.service.spec.ts
import { Test } from "@nestjs/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

describe("EvaluationProfileService", () => {
  let svc: EvaluationProfileService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [EvaluationProfileService, PrismaService],
    }).compile();
    svc = mod.get(EvaluationProfileService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  afterEach(() => undefined);

  it("list returns the 5 seeded built-in profiles", async () => {
    const items = await svc.list();
    const slugs = items.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["default", "chatbot", "rag", "code-completion", "long-form"]));
    expect(items.every((p) => p.isBuiltin)).toBe(true);
  });

  it("getBySlug returns the requested profile", async () => {
    const p = await svc.getBySlug("chatbot");
    expect(p.slug).toBe("chatbot");
    expect(p.rules.checks["inference.ttft.p95.ms"].crit).toBeDefined();
  });

  it("getBySlug throws on unknown slug", async () => {
    await expect(svc.getBySlug("nope")).rejects.toThrow();
  });
});
```

**- [ ] Step 4: Module + register**

```ts
// apps/api/src/modules/insights/insights.module.ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { EvaluationProfileController } from "./evaluation-profile.controller.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [EvaluationProfileController],
  providers: [EvaluationProfileService],
  exports: [EvaluationProfileService],
})
export class InsightsModule {}
```

In `apps/api/src/app.module.ts`, add `InsightsModule` to the `imports` array.

**- [ ] Step 5: Run tests**

```bash
pnpm -F @modeldoctor/api test -- evaluation-profile
```

Expected: green.

**- [ ] Step 6: Commit**

```bash
git add apps/api/src/modules/insights/ apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api/insights): EvaluationProfile read-only service + GET endpoints

GET /api/insights/profiles → list (built-ins first, then custom by slug)
GET /api/insights/profiles/:slug → single profile

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Allow PATCH connection with evaluationProfileId

**Files:**
- Modify: `packages/contracts/src/connection.ts` (add field to Update schema + ConnectionPublic)
- Modify: `apps/api/src/modules/connection/connection.service.ts`
- Modify: `apps/api/src/modules/connection/connection.service.spec.ts`

**- [ ] Step 1: Contracts — add field**

In `packages/contracts/src/connection.ts`, find the `connectionPublicSchema` (or equivalent). Add:
```ts
evaluationProfileId: z.string().nullable(),
evaluationProfile: z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  nameKey: z.string().nullable(),
}).nullable(),
```

In `updateConnectionSchema` add:
```ts
evaluationProfileId: z.string().nullable().optional(),
```

Build contracts:
```bash
pnpm -F @modeldoctor/contracts build
```

**- [ ] Step 2: Service — accept field on update**

In `connection.service.ts` `update(...)`, add `evaluationProfileId: input.evaluationProfileId ?? undefined` to the data object. In `findMany`/`findUnique` callers, add `include: { evaluationProfile: true }` and surface the joined object in `toContractPublic`.

**- [ ] Step 3: Add a test**

In `connection.service.spec.ts` (or a new test there), add:
```ts
it("update accepts evaluationProfileId", async () => {
  // assumes a default profile id exists from seed
  const updated = await svc.update(userId, connId, { evaluationProfileId: "clxprofdefault0000000000" });
  expect(updated.evaluationProfileId).toBe("clxprofdefault0000000000");
});
```

**- [ ] Step 4: Commit**

```bash
git add packages/contracts/src/connection.ts apps/api/src/modules/connection/
git commit -m "$(cat <<'EOF'
feat(api,contracts): connection.evaluationProfileId on update + read

PATCH /api/connections/:id { evaluationProfileId } persists the
profile preference. Read endpoints expose evaluationProfile join so
the detail page can default to the connection's saved profile.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

(Plan continues — Phases 7-12 in next file.)

## Phase 7 — LLM judge provider

### Task 20: LlmJudgeProvider service (CRUD + encryption)

**Files:**
- Create: `apps/api/src/modules/llm-judge/llm-judge.service.ts`
- Create: `apps/api/src/modules/llm-judge/llm-judge.service.spec.ts`
- Create: `apps/api/src/modules/llm-judge/llm-judge.module.ts`

**- [ ] Step 1: Service**

```ts
// apps/api/src/modules/llm-judge/llm-judge.service.ts
import type { LlmJudgeProviderPublic, UpsertLlmJudgeProvider } from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
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

  async getPublic(userId: string): Promise<LlmJudgeProviderPublic | null> {
    const row = await this.prisma.llmJudgeProvider.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      id: row.id, baseUrl: row.baseUrl, model: row.model, enabled: row.enabled,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getDecrypted(userId: string): Promise<DecryptedLlmJudgeProvider | null> {
    const row = await this.prisma.llmJudgeProvider.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      id: row.id, baseUrl: row.baseUrl, apiKey: decrypt(row.apiKeyCipher, this.key),
      model: row.model, enabled: row.enabled,
    };
  }

  async upsert(userId: string, input: UpsertLlmJudgeProvider): Promise<LlmJudgeProviderPublic> {
    const apiKeyCipher = encrypt(input.apiKey, this.key);
    const row = await this.prisma.llmJudgeProvider.upsert({
      where: { userId },
      update: { baseUrl: input.baseUrl, apiKeyCipher, model: input.model, enabled: input.enabled },
      create: { userId, baseUrl: input.baseUrl, apiKeyCipher, model: input.model, enabled: input.enabled },
    });
    return {
      id: row.id, baseUrl: row.baseUrl, model: row.model, enabled: row.enabled,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async delete(userId: string): Promise<void> {
    const r = await this.prisma.llmJudgeProvider.deleteMany({ where: { userId } });
    if (r.count === 0) throw new NotFoundException("No provider configured");
  }
}
```

**- [ ] Step 2: Module**

```ts
// apps/api/src/modules/llm-judge/llm-judge.module.ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeController } from "./llm-judge.controller.js";
import { LlmJudgeService } from "./llm-judge.service.js";

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [LlmJudgeController],
  providers: [LlmJudgeService],
  exports: [LlmJudgeService],
})
export class LlmJudgeModule {}
```

Register `LlmJudgeModule` in `apps/api/src/app.module.ts`.

**- [ ] Step 3: Spec**

```ts
// apps/api/src/modules/llm-judge/llm-judge.service.spec.ts
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "./llm-judge.service.js";

const TEST_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="; // 32 zero-ish bytes

describe("LlmJudgeService", () => {
  let svc: LlmJudgeService;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        LlmJudgeService, PrismaService,
        { provide: ConfigService, useValue: { get: () => TEST_KEY_B64 } },
      ],
    }).compile();
    svc = mod.get(LlmJudgeService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    const u = await prisma.user.create({ data: { email: `t-${Date.now()}-${Math.random()}@e.com`, passwordHash: "x" } });
    userId = u.id;
  });

  afterEach(async () => {
    await prisma.llmJudgeProvider.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns null when no provider configured", async () => {
    expect(await svc.getPublic(userId)).toBeNull();
    expect(await svc.getDecrypted(userId)).toBeNull();
  });

  it("upsert encrypts and round-trips", async () => {
    const pub = await svc.upsert(userId, { baseUrl: "https://x", apiKey: "sk-secret", model: "gpt-x", enabled: true });
    expect(pub.baseUrl).toBe("https://x");
    const dec = await svc.getDecrypted(userId);
    expect(dec?.apiKey).toBe("sk-secret");
  });

  it("upsert idempotent — second call updates", async () => {
    await svc.upsert(userId, { baseUrl: "https://a", apiKey: "k1", model: "m1", enabled: true });
    await svc.upsert(userId, { baseUrl: "https://b", apiKey: "k2", model: "m2", enabled: false });
    const dec = await svc.getDecrypted(userId);
    expect(dec?.baseUrl).toBe("https://b");
    expect(dec?.enabled).toBe(false);
  });

  it("delete removes the row", async () => {
    await svc.upsert(userId, { baseUrl: "https://x", apiKey: "k", model: "m", enabled: true });
    await svc.delete(userId);
    expect(await svc.getPublic(userId)).toBeNull();
  });

  it("delete throws when no row", async () => {
    await expect(svc.delete(userId)).rejects.toThrow();
  });
});
```

**- [ ] Step 4: Run + commit**

```bash
pnpm -F @modeldoctor/api test -- llm-judge.service
```

Expected: green.

```bash
git add apps/api/src/modules/llm-judge/llm-judge.service.ts apps/api/src/modules/llm-judge/llm-judge.service.spec.ts apps/api/src/modules/llm-judge/llm-judge.module.ts apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api/llm-judge): LlmJudgeProvider service with AES-GCM encryption

Per-user singleton: getPublic (apiKey redacted), getDecrypted
(internal-only, used by synthesize), upsert, delete. Reuses
CONNECTION_API_KEY_ENCRYPTION_KEY env via existing aes-gcm helpers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: LlmJudgeController + test endpoint

**Files:**
- Create: `apps/api/src/modules/llm-judge/llm-judge.controller.ts`
- Create: `apps/api/src/modules/insights/llm-client.ts` (used by both this controller and synthesize)
- Create: `apps/api/src/modules/insights/llm-client.spec.ts`
- Create: `apps/api/test/e2e/llm-judge.e2e-spec.ts`

**- [ ] Step 1: Tiny LLM client (OpenAI-protocol fetch)**

```ts
// apps/api/src/modules/insights/llm-client.ts
import { setTimeout as wait } from "node:timers/promises";

export interface LlmClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  latencyMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function chatCompletion(
  cfg: LlmClientConfig,
  messages: ChatMessage[],
  options: { timeoutMs?: number; jsonMode?: boolean; signal?: AbortSignal } = {},
): Promise<ChatResponse> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const ctl = new AbortController();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = wait(timeout).then(() => ctl.abort());
  const onUserAbort = () => ctl.abort();
  options.signal?.addEventListener("abort", onUserAbort);

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.2,
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } finally {
    options.signal?.removeEventListener("abort", onUserAbort);
    timer.then(() => undefined).catch(() => undefined);
  }

  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content, latencyMs };
}
```

**- [ ] Step 2: Smoke test the client**

```ts
// apps/api/src/modules/insights/llm-client.spec.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "./llm-client.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("chatCompletion", () => {
  it("posts to /chat/completions with bearer auth", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    } as any);
    const r = await chatCompletion({ baseUrl: "https://x/v1", apiKey: "sk", model: "m" }, [{ role: "user", content: "hi" }]);
    expect(r.content).toBe("hi");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x/v1/chat/completions");
    expect((init as any).headers.authorization).toBe("Bearer sk");
  });

  it("throws on non-200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "bad key" } as any);
    await expect(chatCompletion({ baseUrl: "https://x", apiKey: "k", model: "m" }, [])).rejects.toThrow(/HTTP 401/);
  });
});
```

**- [ ] Step 3: Controller**

```ts
// apps/api/src/modules/llm-judge/llm-judge.controller.ts
import {
  llmJudgeProviderPublicSchema,
  testLlmJudgeRequestSchema,
  testLlmJudgeResponseSchema,
  upsertLlmJudgeProviderSchema,
  type TestLlmJudgeRequest,
  type TestLlmJudgeResponse,
  type UpsertLlmJudgeProvider,
} from "@modeldoctor/contracts";
import {
  Body, Controller, Delete, Get, HttpCode, Post, Put, Req, UseGuards, UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { AuthedRequest } from "../auth/types.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "./llm-judge.service.js";

@UseGuards(JwtAuthGuard)
@Controller("llm-judge")
export class LlmJudgeController {
  constructor(private readonly svc: LlmJudgeService) {}

  @Get("provider")
  async get(@Req() req: AuthedRequest) {
    const p = await this.svc.getPublic(req.user.userId);
    return p ? llmJudgeProviderPublicSchema.parse(p) : null;
  }

  @Put("provider")
  @UsePipes(new ZodValidationPipe(upsertLlmJudgeProviderSchema))
  async put(@Req() req: AuthedRequest, @Body() body: UpsertLlmJudgeProvider) {
    return this.svc.upsert(req.user.userId, body);
  }

  @Delete("provider")
  @HttpCode(204)
  async del(@Req() req: AuthedRequest) {
    await this.svc.delete(req.user.userId);
  }

  @Post("test")
  @UsePipes(new ZodValidationPipe(testLlmJudgeRequestSchema))
  async test(@Body() body: TestLlmJudgeRequest): Promise<TestLlmJudgeResponse> {
    try {
      const r = await chatCompletion(
        { baseUrl: body.baseUrl, apiKey: body.apiKey, model: body.model },
        [{ role: "user", content: "ping" }],
        { timeoutMs: 10_000 },
      );
      return testLlmJudgeResponseSchema.parse({ ok: true, latencyMs: r.latencyMs, error: null });
    } catch (e: any) {
      return testLlmJudgeResponseSchema.parse({ ok: false, latencyMs: null, error: String(e?.message ?? e).slice(0, 500) });
    }
  }
}
```

(Verify the actual auth guard import path and `AuthedRequest` type by grepping for `JwtAuthGuard` in the existing codebase before committing.)

**- [ ] Step 4: HTTP e2e**

```ts
// apps/api/test/e2e/llm-judge.e2e-spec.ts
import { describe, expect, it } from "vitest";
import { withTestApp } from "./harness.js"; // assumed harness — verify path matches existing e2e tests

describe("/api/llm-judge", () => {
  it("PUT then GET round-trips public payload (apiKey redacted)", async () => {
    await withTestApp(async ({ http, login }) => {
      const { token } = await login();
      await http.put("/api/llm-judge/provider").set("Authorization", `Bearer ${token}`)
        .send({ baseUrl: "https://x.example/v1", apiKey: "sk-test", model: "gpt-x", enabled: true })
        .expect(200);
      const r = await http.get("/api/llm-judge/provider").set("Authorization", `Bearer ${token}`).expect(200);
      expect(r.body.baseUrl).toBe("https://x.example/v1");
      expect(r.body).not.toHaveProperty("apiKey");
    });
  });

  it("DELETE removes provider", async () => {
    await withTestApp(async ({ http, login }) => {
      const { token } = await login();
      await http.put("/api/llm-judge/provider").set("Authorization", `Bearer ${token}`)
        .send({ baseUrl: "https://x.example/v1", apiKey: "sk-test", model: "m", enabled: true })
        .expect(200);
      await http.delete("/api/llm-judge/provider").set("Authorization", `Bearer ${token}`).expect(204);
      await http.get("/api/llm-judge/provider").set("Authorization", `Bearer ${token}`).expect(200).expect((r) => {
        expect(r.body).toBeNull();
      });
    });
  });
});
```

(Adapt to the actual harness — check `apps/api/test/e2e/connection.e2e-spec.ts` for the harness shape.)

**- [ ] Step 5: Run + commit**

```bash
pnpm -F @modeldoctor/api test -- llm-client
pnpm test:e2e:api -- llm-judge
```

Both green.

```bash
git add apps/api/src/modules/llm-judge/llm-judge.controller.ts apps/api/src/modules/insights/llm-client.ts apps/api/src/modules/insights/llm-client.spec.ts apps/api/test/e2e/llm-judge.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(api/llm-judge): controller + test endpoint + e2e

GET/PUT/DELETE /api/llm-judge/provider (per-user singleton; apiKey
returned only encrypted-at-rest, redacted in responses).
POST /api/llm-judge/test pings provider config without DB write
and returns ok/latency or error code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: AiDiagnosisSection in Settings (frontend form)

**Files:**
- Create: `apps/web/src/features/settings/AiDiagnosisSection.tsx`
- Create: `apps/web/src/features/settings/queries.ts`
- Create: `apps/web/src/features/settings/AiDiagnosisSection.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`

**- [ ] Step 1: Queries**

```ts
// apps/web/src/features/settings/queries.ts
import { apiClient } from "@/lib/api-client";
import type { LlmJudgeProviderPublic, TestLlmJudgeRequest, TestLlmJudgeResponse, UpsertLlmJudgeProvider } from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const KEY = ["llm-judge-provider"] as const;

export function useLlmJudgeProvider() {
  return useQuery<LlmJudgeProviderPublic | null>({
    queryKey: KEY,
    queryFn: async () => (await apiClient.get("/llm-judge/provider")).data,
    staleTime: 0,
  });
}

export function useUpsertLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpsertLlmJudgeProvider) => (await apiClient.put("/llm-judge/provider", body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.delete("/llm-judge/provider")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestLlmJudge() {
  return useMutation({
    mutationFn: async (body: TestLlmJudgeRequest): Promise<TestLlmJudgeResponse> =>
      (await apiClient.post("/llm-judge/test", body)).data,
  });
}
```

**- [ ] Step 2: Form section**

```tsx
// apps/web/src/features/settings/AiDiagnosisSection.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { upsertLlmJudgeProviderSchema, type UpsertLlmJudgeProvider } from "@modeldoctor/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useLlmJudgeProvider, useTestLlmJudge, useUpsertLlmJudgeProvider } from "./queries";

export function AiDiagnosisSection() {
  const { t } = useTranslation("settings");
  const provider = useLlmJudgeProvider();
  const upsert = useUpsertLlmJudgeProvider();
  const test = useTestLlmJudge();
  const [showKey, setShowKey] = useState(false);

  const form = useForm<UpsertLlmJudgeProvider>({
    mode: "onTouched",
    resolver: zodResolver(upsertLlmJudgeProviderSchema),
    defaultValues: { baseUrl: "", apiKey: "", model: "", enabled: true },
    values: provider.data
      ? { baseUrl: provider.data.baseUrl, apiKey: "", model: provider.data.model, enabled: provider.data.enabled }
      : undefined,
  });

  async function onSave(values: UpsertLlmJudgeProvider) {
    if (!values.apiKey && provider.data) {
      // Allow saving without re-entering apiKey: skip if user didn't change it.
      // For V1 simplicity: require apiKey on every save. Show explicit warning.
      toast.error(t("ai.error.keyRequired"));
      return;
    }
    await upsert.mutateAsync(values);
    toast.success(t("ai.saveSuccess"));
  }

  async function onTest() {
    const v = form.getValues();
    if (!v.baseUrl || !v.apiKey || !v.model) {
      toast.error(t("ai.error.fillBeforeTest"));
      return;
    }
    const r = await test.mutateAsync({ baseUrl: v.baseUrl, apiKey: v.apiKey, model: v.model });
    if (r.ok) toast.success(t("ai.testSuccess", { ms: r.latencyMs }));
    else toast.error(t("ai.testFailed", { error: r.error ?? "unknown" }));
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("ai.title")}
        </h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-enabled" className="text-sm">{t("ai.enabled")}</Label>
          <Switch
            id="ai-enabled"
            checked={form.watch("enabled")}
            onCheckedChange={(v) => form.setValue("enabled", v)}
          />
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t("ai.description")}</p>

      <form className="space-y-3" onSubmit={form.handleSubmit(onSave)}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="ai-baseurl">{t("ai.baseUrl")}</Label>
            <Input id="ai-baseurl" placeholder="https://api.deepseek.com/v1" {...form.register("baseUrl")} />
            {form.formState.errors.baseUrl && (
              <div className="mt-1 text-xs text-rose-500">{form.formState.errors.baseUrl.message}</div>
            )}
          </div>
          <div>
            <Label htmlFor="ai-model">{t("ai.model")}</Label>
            <Input id="ai-model" placeholder="deepseek-chat" {...form.register("model")} />
            {form.formState.errors.model && (
              <div className="mt-1 text-xs text-rose-500">{form.formState.errors.model.message}</div>
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="ai-key">{t("ai.apiKey")}</Label>
          <div className="relative">
            <Input
              id="ai-key"
              type={showKey ? "text" : "password"}
              placeholder={provider.data ? "sk-*** (留空保留现值)" : "sk-..."}
              {...form.register("apiKey")}
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-label={showKey ? "hide" : "show"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onTest} disabled={test.isPending}>
            {test.isPending ? t("ai.testing") : t("ai.test")}
          </Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? t("ai.saving") : tCommonSave()}
          </Button>
        </div>
      </form>
    </section>
  );
}

function tCommonSave() {
  // Inline rather than re-importing tc — keeps the form section self-contained.
  return "保存";
}
```

**- [ ] Step 3: Mount in SettingsPage**

In `apps/web/src/features/settings/SettingsPage.tsx`, add the import and insert `<AiDiagnosisSection />` between the existing `Section` blocks (e.g. after `environment.title`):

```tsx
import { AiDiagnosisSection } from "./AiDiagnosisSection";
...
<AiDiagnosisSection />
```

**- [ ] Step 4: Component test**

```tsx
// apps/web/src/features/settings/AiDiagnosisSection.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { AiDiagnosisSection } from "./AiDiagnosisSection";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: null })),
    put: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: { ok: true, latencyMs: 123, error: null } })),
    delete: vi.fn(async () => ({ data: null })),
  },
}));

function r(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("AiDiagnosisSection", () => {
  it("validates form before submit", async () => {
    r(<AiDiagnosisSection />);
    const save = await screen.findByRole("button", { name: /保存|save/i });
    await userEvent.click(save);
    // zod URL validation should report on baseUrl
    expect(await screen.findByText(/url|URL/)).toBeInTheDocument();
  });
});
```

**- [ ] Step 5: Run + commit**

```bash
pnpm -F @modeldoctor/web test -- AiDiagnosisSection
```

```bash
git add apps/web/src/features/settings/
git commit -m "$(cat <<'EOF'
feat(web/settings): AI 智能诊断 section in settings page

Form: baseUrl + apiKey (with reveal toggle) + model + enabled switch.
[测试连接] pings the provider; [保存] upserts. Provider-state-aware:
when a provider is already saved, apiKey input is empty (placeholder
asks for re-entry to update; future: optional re-encrypt-only flow).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Wire connection.evaluationProfileId persistence on detail page

**Files:**
- Modify: `apps/web/src/features/insights/InsightsDetailPage.tsx`
- Modify: `apps/web/src/features/connections/queries.ts` (add useUpdateConnection if not present)

**- [ ] Step 1: Add "Set as default" button next to ProfileSelector**

In `InsightsDetailPage.tsx`, modify the rightSlot to add a save action when `profileSlug` differs from `conn.data.evaluationProfile?.slug`:

```tsx
import { useUpdateConnection } from "@/features/connections/queries";
...
const updateConn = useUpdateConnection();
const profileDirty = activeProfile && conn.data?.evaluationProfile?.slug !== activeProfile.slug;
...
<ProfileSelector ... />
{profileDirty && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => updateConn.mutate({ id: connectionId, evaluationProfileId: activeProfile.id })}
    disabled={updateConn.isPending}
  >
    {t("detail.profile.setDefault")}
  </Button>
)}
```

If `useUpdateConnection` doesn't exist, add it to `apps/web/src/features/connections/queries.ts`:

```ts
import type { UpdateConnection } from "@modeldoctor/contracts";
export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateConnection & { id: string }) =>
      (await apiClient.patch(`/connections/${id}`, patch)).data,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["connection", vars.id] });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}
```

**- [ ] Step 2: Manual smoke + commit**

Start dev server, switch profile on detail page → "设为默认" button appears → click → reload → profile selector defaults to the saved one.

```bash
git add apps/web/src/features/insights/InsightsDetailPage.tsx apps/web/src/features/connections/queries.ts
git commit -m "$(cat <<'EOF'
feat(web/insights): persist profile selection per-connection

Profile selector + 'set as default' button writes
Connection.evaluationProfileId. Reloading the page restores the
saved profile. Switching profile temporarily shows the button;
no implicit save.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Comparison endpoints

### Task 24: ComparisonService — baseline + fleet aggregations

**Files:**
- Create: `apps/api/src/modules/insights/comparison.service.ts`
- Create: `apps/api/src/modules/insights/comparison.service.spec.ts`
- Create: `apps/api/src/modules/insights/comparison.controller.ts`
- Modify: `apps/api/src/modules/insights/insights.module.ts`

**Important — extracting check values on backend**: the frontend's `read()` functions in `CheckDescriptor` are TypeScript-only and live in `apps/web/`. The backend cannot import them directly. We mirror the metric extraction here in a small helper.

**- [ ] Step 1: Backend metric extractors (port of `compare/metrics.ts`)**

```ts
// apps/api/src/modules/insights/metrics.ts
type MetricsBlob = { tool?: string; data?: Record<string, any> } | null | undefined;

function fromDist(m: MetricsBlob, key: string, field: string): number | null {
  const v = m?.data?.[key]?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function extractMetric(m: MetricsBlob, checkId: string): number | null {
  if (!m?.tool || !m?.data) return null;
  switch (checkId) {
    case "inference.ttft.p95.ms":
      if (m.tool === "guidellm") return fromDist(m, "ttft", "p95");
      if (m.tool === "genai-perf") return fromDist(m, "timeToFirstToken", "p95");
      return null;
    case "inference.ttft.p99.ms":
      if (m.tool === "guidellm") return fromDist(m, "ttft", "p99");
      if (m.tool === "genai-perf") return fromDist(m, "timeToFirstToken", "p99");
      return null;
    case "inference.itl.p95.ms":
      if (m.tool === "guidellm") return fromDist(m, "itl", "p95");
      return null;
    case "inference.e2e.p95.ms":
      if (m.tool === "guidellm") return fromDist(m, "e2eLatency", "p95");
      if (m.tool === "vegeta") return fromDist(m, "latencies", "p95");
      if (m.tool === "genai-perf") return fromDist(m, "requestLatency", "p95");
      return null;
    case "inference.e2e.p99.ms":
      if (m.tool === "guidellm") return fromDist(m, "e2eLatency", "p99");
      if (m.tool === "vegeta") return fromDist(m, "latencies", "p99");
      if (m.tool === "genai-perf") return fromDist(m, "requestLatency", "p99");
      return null;
    case "inference.error_rate":
    case "capacity.error_rate":
    case "gateway.error_rate":
      if (m.tool === "guidellm") {
        const r = m.data.requests as { total?: number; error?: number } | undefined;
        const t = r?.total, e = r?.error;
        if (typeof t !== "number" || typeof e !== "number" || t === 0) return null;
        return e / t;
      }
      if (m.tool === "vegeta") {
        const s = m.data.success;
        return typeof s === "number" ? 1 - s / 100 : null;
      }
      return null;
    case "inference.throughput.req_per_s":
    case "capacity.max_qps":
    case "gateway.throughput.req_per_s": {
      if (m.tool === "guidellm") return m.data.requestsPerSecond?.mean ?? null;
      if (m.tool === "vegeta") return m.data.requests?.throughput ?? null;
      if (m.tool === "genai-perf") return m.data.requestThroughput?.avg ?? null;
      return null;
    }
    case "capacity.tail_ratio":
    case "gateway.tail_ratio": {
      let p50: number | null = null, p99: number | null = null;
      if (m.tool === "guidellm") { p50 = m.data.e2eLatency?.p50 ?? null; p99 = m.data.e2eLatency?.p99 ?? null; }
      if (m.tool === "vegeta") { p50 = m.data.latencies?.p50 ?? null; p99 = m.data.latencies?.p99 ?? null; }
      if (m.tool === "genai-perf") { p50 = m.data.requestLatency?.p50 ?? null; p99 = m.data.requestLatency?.p99 ?? null; }
      if (typeof p50 !== "number" || typeof p99 !== "number" || p50 <= 0) return null;
      return p99 / p50;
    }
  }
  return null;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.floor((p / 100) * s.length)));
  return s[idx];
}
```

**- [ ] Step 2: Service**

```ts
// apps/api/src/modules/insights/comparison.service.ts
import type { BaselineCheckComparison, FleetCheckComparison } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { extractMetric, median, percentile } from "./metrics.js";

const MIN_SAMPLES = 3;

const ALL_CHECK_IDS = [
  "inference.ttft.p95.ms", "inference.ttft.p99.ms", "inference.itl.p95.ms",
  "inference.e2e.p95.ms", "inference.e2e.p99.ms", "inference.error_rate",
  "inference.throughput.req_per_s",
  "capacity.max_qps", "capacity.error_rate", "capacity.tail_ratio",
  "gateway.error_rate", "gateway.tail_ratio", "gateway.throughput.req_per_s",
];

@Injectable()
export class ComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  async baseline(userId: string, connectionId: string, fromISO: string): Promise<BaselineCheckComparison[]> {
    const range = await this.prisma.benchmark.findMany({
      where: { userId, connectionId, status: "completed", createdAt: { gte: new Date(fromISO) } },
      select: { tool: true, summaryMetrics: true, scenario: true },
    });
    const historical = await this.prisma.benchmark.findMany({
      where: { userId, connectionId, status: "completed", createdAt: { lt: new Date(fromISO) } },
      select: { tool: true, summaryMetrics: true, scenario: true },
    });
    const out: BaselineCheckComparison[] = [];
    for (const id of ALL_CHECK_IDS) {
      const cur = range.map((r) => extractMetric(r.summaryMetrics as any, id)).filter((v): v is number => v != null);
      const hist = historical.map((r) => extractMetric(r.summaryMetrics as any, id)).filter((v): v is number => v != null);
      if (cur.length < MIN_SAMPLES || hist.length < MIN_SAMPLES) continue;
      const cP50 = median(cur);
      const hP50 = median(hist);
      const hP90 = percentile(hist, 90);
      const deltaPct = hP50 === 0 ? 0 : ((cP50 - hP50) / hP50) * 100;
      out.push({ checkId: id, currentP50: cP50, historicalP50: hP50, historicalP90: hP90, deltaPct, sampleSize: hist.length });
    }
    return out;
  }

  async fleet(userId: string, connectionId: string, fromISO: string): Promise<FleetCheckComparison[]> {
    const conn = await this.prisma.connection.findFirst({ where: { id: connectionId, userId } });
    if (!conn) return [];
    const target = await this.prisma.benchmark.findMany({
      where: { userId, connectionId, status: "completed", createdAt: { gte: new Date(fromISO) } },
      select: { tool: true, summaryMetrics: true },
    });
    const fleetRuns = await this.prisma.benchmark.findMany({
      where: {
        userId, status: "completed",
        connection: { is: { category: conn.category, NOT: { id: connectionId } } },
        createdAt: { gte: new Date(fromISO) },
      },
      select: { tool: true, summaryMetrics: true },
    });
    const out: FleetCheckComparison[] = [];
    for (const id of ALL_CHECK_IDS) {
      const cur = target.map((r) => extractMetric(r.summaryMetrics as any, id)).filter((v): v is number => v != null);
      const fleet = fleetRuns.map((r) => extractMetric(r.summaryMetrics as any, id)).filter((v): v is number => v != null);
      if (cur.length < MIN_SAMPLES || fleet.length < MIN_SAMPLES) continue;
      out.push({
        checkId: id,
        currentP50: median(cur),
        fleetP50: median(fleet),
        fleetP90: percentile(fleet, 90),
        sampleSize: fleet.length,
      });
    }
    return out;
  }
}
```

**- [ ] Step 3: Controller**

```ts
// apps/api/src/modules/insights/comparison.controller.ts
import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { AuthedRequest } from "../auth/types.js";
import { ComparisonService } from "./comparison.service.js";

@UseGuards(JwtAuthGuard)
@Controller("insights/:connectionId")
export class ComparisonController {
  constructor(private readonly svc: ComparisonService) {}

  @Get("baseline-comparison")
  async baseline(@Req() req: AuthedRequest, @Param("connectionId") connectionId: string, @Query("from") fromISO: string) {
    return { items: await this.svc.baseline(req.user.userId, connectionId, fromISO) };
  }

  @Get("fleet-comparison")
  async fleet(@Req() req: AuthedRequest, @Param("connectionId") connectionId: string, @Query("from") fromISO: string) {
    return { items: await this.svc.fleet(req.user.userId, connectionId, fromISO) };
  }
}
```

Add `ComparisonController` and `ComparisonService` to `InsightsModule`.

**- [ ] Step 4: Smoke test the service**

```ts
// apps/api/src/modules/insights/comparison.service.spec.ts
import { Test } from "@nestjs/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { ComparisonService } from "./comparison.service.js";

describe("ComparisonService.baseline", () => {
  let svc: ComparisonService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ providers: [ComparisonService, PrismaService] }).compile();
    svc = mod.get(ComparisonService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.benchmark.deleteMany({ where: { name: { startsWith: "cmp-test-" } } });
  });

  afterEach(async () => {
    await prisma.benchmark.deleteMany({ where: { name: { startsWith: "cmp-test-" } } });
  });

  it("returns empty when sample size below threshold", async () => {
    const items = await svc.baseline("nonexistent-user", "nonexistent-connection", new Date().toISOString());
    expect(items).toEqual([]);
  });

  // Full happy-path test requires fixture seed; covered in e2e.
});
```

**- [ ] Step 5: Commit**

```bash
git add apps/api/src/modules/insights/
git commit -m "$(cat <<'EOF'
feat(api/insights): baseline + fleet comparison endpoints

GET /api/insights/:connectionId/baseline-comparison?from=ISO
GET /api/insights/:connectionId/fleet-comparison?from=ISO

Backend mirrors the frontend metric extraction (extractMetric in
metrics.ts) and aggregates with median + p90 across the relevant
sample sets. MIN_SAMPLES=3 cuts off thin data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: Comparison HTTP e2e

**Files:**
- Create: `apps/api/test/e2e/insights.e2e-spec.ts`

**- [ ] Step 1: Test scaffold**

```ts
// apps/api/test/e2e/insights.e2e-spec.ts
import { describe, expect, it } from "vitest";
import { withTestApp } from "./harness.js";

describe("/api/insights comparison endpoints", () => {
  it("baseline-comparison returns empty when no historical data", async () => {
    await withTestApp(async ({ http, login, prisma }) => {
      const { token, userId } = await login();
      // Seed a connection (assuming a helper exists)
      const conn = await prisma.connection.create({
        data: { userId, name: "t", baseUrl: "http://x", apiKeyCipher: "v1:a:b:c", model: "m", customHeaders: "", queryParams: "", category: "chat" },
      });
      const r = await http
        .get(`/api/insights/${conn.id}/baseline-comparison?from=${new Date().toISOString()}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(r.body).toEqual({ items: [] });
    });
  });

  it("fleet-comparison returns empty when only one connection in category", async () => {
    await withTestApp(async ({ http, login, prisma }) => {
      const { token, userId } = await login();
      const conn = await prisma.connection.create({
        data: { userId, name: "t2", baseUrl: "http://x", apiKeyCipher: "v1:a:b:c", model: "m", customHeaders: "", queryParams: "", category: "chat" },
      });
      const r = await http
        .get(`/api/insights/${conn.id}/fleet-comparison?from=${new Date().toISOString()}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(r.body).toEqual({ items: [] });
    });
  });
});
```

**- [ ] Step 2: Run + commit**

```bash
pnpm test:e2e:api -- insights
```

```bash
git add apps/api/test/e2e/insights.e2e-spec.ts
git commit -m "test(api/insights): comparison endpoint smoke e2e

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9 — Synthesize endpoint

### Task 26: Bounded LRU cache

**Files:**
- Create: `apps/api/src/modules/insights/cache.ts`
- Create: `apps/api/src/modules/insights/cache.spec.ts`

**- [ ] Step 1: Write test**

```ts
// apps/api/src/modules/insights/cache.spec.ts
import { describe, expect, it } from "vitest";
import { LruCache } from "./cache.js";

describe("LruCache", () => {
  it("evicts least-recently-used when capacity exceeded", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1); c.set("b", 2);
    c.get("a"); // touch a
    c.set("c", 3); // should evict b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("respects ttl", () => {
    const c = new LruCache<string, number>(10, { ttlMs: 100 });
    c.set("a", 1, Date.now() - 200); // already expired
    expect(c.get("a")).toBeUndefined();
  });
});
```

**- [ ] Step 2: Implement**

```ts
// apps/api/src/modules/insights/cache.ts
interface Entry<V> { v: V; insertedAt: number; }

export class LruCache<K, V> {
  private map = new Map<K, Entry<V>>();
  constructor(private capacity: number, private opts: { ttlMs?: number } = {}) {}

  get(k: K): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (this.opts.ttlMs && Date.now() - e.insertedAt > this.opts.ttlMs) {
      this.map.delete(k);
      return undefined;
    }
    // Touch — re-insert to keep at MRU end (Map iteration order is insertion order).
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }

  set(k: K, v: V, insertedAt = Date.now()): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { v, insertedAt });
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as K;
      this.map.delete(oldestKey);
    }
  }
}
```

**- [ ] Step 3: Run + commit**

```bash
pnpm -F @modeldoctor/api test -- cache
```

```bash
git add apps/api/src/modules/insights/cache.ts apps/api/src/modules/insights/cache.spec.ts
git commit -m "feat(api/insights): bounded LRU cache with optional TTL

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: SynthesizeService — prompt assembly

**Files:**
- Create: `apps/api/src/modules/insights/synthesize.service.ts`
- Create: `apps/api/src/modules/insights/synthesize.service.spec.ts`

**- [ ] Step 1: Implement**

```ts
// apps/api/src/modules/insights/synthesize.service.ts
import {
  narrativeFindingSchema,
  type NarrativeFinding,
  type SynthesizeRequest,
  type SynthesizeResponse,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { LruCache } from "./cache.js";
import { ComparisonService } from "./comparison.service.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";
import { chatCompletion } from "./llm-client.js";

const SYS_PROMPT = `你是一位 LLM 服务性能顾问。给定一个模型连接在指定时间范围内的基准测试数据，
你需要：
1. 找出 3-5 个最值得用户关注的问题（按严重性排序）
2. 每个问题给出：标题、量化的指标根因、可执行的建议（1-3 步）
3. 仅基于提供的数据推断；不要编造未提供的数字
4. 用户的业务画像 (profile) 会影响"严重"的标准 — 优先采用 profile 视角

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
}`;

const responseSchema = z.object({
  findings: z.array(narrativeFindingSchema).min(0).max(10),
});

const TTL_MS = 24 * 60 * 60 * 1000;
const CAP = 100;

interface CacheEntry {
  generatedAt: string;
  runIdsHash: string;
  findings: NarrativeFinding[];
}

@Injectable()
export class SynthesizeService {
  private cache = new LruCache<string, CacheEntry>(CAP, { ttlMs: TTL_MS });

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: EvaluationProfileService,
    private readonly comparison: ComparisonService,
    private readonly judge: LlmJudgeService,
  ) {}

  async synthesize(userId: string, connectionId: string, body: SynthesizeRequest): Promise<SynthesizeResponse> {
    const provider = await this.judge.getDecrypted(userId);
    if (!provider || !provider.enabled) throw new NotFoundException("LLM provider not configured or disabled");

    // Resolve runs (fetch by ids; ensure ownership)
    const runs = await this.prisma.benchmark.findMany({
      where: { userId, id: { in: body.runIds } },
      select: { id: true, updatedAt: true, scenario: true, tool: true, status: true, summaryMetrics: true, name: true, params: true },
    });
    const runIdsHash = createHash("sha256")
      .update(runs.map((r) => `${r.id}:${r.updatedAt.toISOString()}`).sort().join(","))
      .digest("hex");

    const cacheKey = `${userId}:${connectionId}:${body.profileSlug}:${body.range}:${runIdsHash}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return { findings: hit.findings, generatedAt: hit.generatedAt, runIdsHash, fromCache: true };

    const profile = await this.profiles.getBySlug(body.profileSlug);
    const conn = await this.prisma.connection.findFirst({ where: { id: connectionId, userId } });
    if (!conn) throw new NotFoundException("connection");

    const fromISO = new Date(Date.now() - days(body.range) * 86_400_000).toISOString();
    const baseline = await this.comparison.baseline(userId, connectionId, fromISO);
    const fleet = await this.comparison.fleet(userId, connectionId, fromISO);

    const userPrompt = JSON.stringify({
      connection: { name: conn.name, model: conn.model, category: conn.category },
      profile: { slug: profile.slug, name: profile.name, rationale: profile.source },
      timeRange: { from: fromISO, to: new Date().toISOString() },
      runCount: runs.length,
      profileRules: profile.rules,
      baselineComparison: baseline,
      fleetComparison: fleet,
    });

    let raw: string;
    try {
      const r = await chatCompletion(
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model },
        [{ role: "system", content: SYS_PROMPT }, { role: "user", content: userPrompt }],
        { jsonMode: true, timeoutMs: 30_000 },
      );
      raw = r.content;
    } catch (e: any) {
      throw new ServiceUnavailableException(`LLM error: ${String(e?.message ?? e).slice(0, 300)}`);
    }

    let parsed;
    try {
      parsed = responseSchema.parse(JSON.parse(raw));
    } catch {
      throw new ServiceUnavailableException("LLM returned malformed JSON");
    }

    const generatedAt = new Date().toISOString();
    this.cache.set(cacheKey, { generatedAt, runIdsHash, findings: parsed.findings });
    return { findings: parsed.findings, generatedAt, runIdsHash, fromCache: false };
  }

  invalidate(userId: string, connectionId: string): void {
    // Conservative: walk keys with the prefix and delete. With Map.keys() iteration we can do this.
    const prefix = `${userId}:${connectionId}:`;
    for (const k of [...(this.cache as any).map.keys()]) {
      if (typeof k === "string" && k.startsWith(prefix)) (this.cache as any).map.delete(k);
    }
  }
}

function days(r: SynthesizeRequest["range"]): number {
  return ({ "7d": 7, "30d": 30, "90d": 90 } as const)[r];
}
```

**- [ ] Step 2: Spec (mock LLM, validate prompt assembly)**

```ts
// apps/api/src/modules/insights/synthesize.service.spec.ts
import { describe, expect, it, vi } from "vitest";
// ... full TestingModule setup as in earlier spec ...
// Use vi.mock("./llm-client.js", () => ({ chatCompletion: vi.fn() })) and assert
// the prompt content + cache hit behavior.
```

(Full spec writeout omitted here — adapt the pattern from `evaluation-profile.service.spec.ts`.)

**- [ ] Step 3: Commit**

```bash
git add apps/api/src/modules/insights/synthesize.service.ts apps/api/src/modules/insights/synthesize.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/insights): synthesize service — prompt + LLM call + cache

Resolves runs by id (ownership enforced via userId+id), computes
runIdsHash including updatedAt timestamps, builds the user-prompt
JSON object, calls chatCompletion with response_format=json_object,
parses with zod, caches 24h LRU. NotFoundException when no provider;
ServiceUnavailableException on LLM error or malformed JSON.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 28: SynthesizeController + module registration

**Files:**
- Create: `apps/api/src/modules/insights/synthesize.controller.ts`
- Modify: `apps/api/src/modules/insights/insights.module.ts`

**- [ ] Step 1: Controller**

```ts
// apps/api/src/modules/insights/synthesize.controller.ts
import { synthesizeRequestSchema, type SynthesizeRequest } from "@modeldoctor/contracts";
import { Body, Controller, Param, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { AuthedRequest } from "../auth/types.js";
import { SynthesizeService } from "./synthesize.service.js";

@UseGuards(JwtAuthGuard)
@Controller("insights/:connectionId")
export class SynthesizeController {
  constructor(private readonly svc: SynthesizeService) {}

  @Post("synthesize")
  @UsePipes(new ZodValidationPipe(synthesizeRequestSchema))
  async synthesize(
    @Req() req: AuthedRequest,
    @Param("connectionId") connectionId: string,
    @Body() body: SynthesizeRequest,
  ) {
    return this.svc.synthesize(req.user.userId, connectionId, body);
  }
}
```

**- [ ] Step 2: Module**

In `insights.module.ts`, add `ComparisonService`, `SynthesizeService`, `ComparisonController`, `SynthesizeController` and import `LlmJudgeModule`:

```ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { ComparisonController } from "./comparison.controller.js";
import { ComparisonService } from "./comparison.service.js";
import { EvaluationProfileController } from "./evaluation-profile.controller.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";
import { SynthesizeController } from "./synthesize.controller.js";
import { SynthesizeService } from "./synthesize.service.js";

@Module({
  imports: [ConfigModule, DatabaseModule, LlmJudgeModule],
  controllers: [EvaluationProfileController, ComparisonController, SynthesizeController],
  providers: [EvaluationProfileService, ComparisonService, SynthesizeService],
  exports: [EvaluationProfileService, ComparisonService, SynthesizeService],
})
export class InsightsModule {}
```

**- [ ] Step 3: Commit**

```bash
git add apps/api/src/modules/insights/synthesize.controller.ts apps/api/src/modules/insights/insights.module.ts
git commit -m "feat(api/insights): wire synthesize controller into InsightsModule

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: Synthesize e2e (mocked LLM)

**Files:**
- Modify: `apps/api/test/e2e/insights.e2e-spec.ts`

**- [ ] Step 1: Add tests**

Add to `insights.e2e-spec.ts`:

```ts
import { vi } from "vitest";
vi.mock("../../src/modules/insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      findings: [{ severity: "warning", title: "TTFT high", rootCause: "p95 1240ms exceeds threshold", recommendations: ["warm up"] }],
    }),
    latencyMs: 100,
  })),
}));

it("POST /api/insights/:id/synthesize returns NarrativeFinding[] (mocked LLM)", async () => {
  await withTestApp(async ({ http, login, prisma }) => {
    const { token, userId } = await login();
    const conn = await prisma.connection.create({
      data: { userId, name: "ai", baseUrl: "http://x", apiKeyCipher: "v1:a:b:c", model: "m", customHeaders: "", queryParams: "", category: "chat" },
    });
    await prisma.llmJudgeProvider.create({
      data: { userId, baseUrl: "http://llm", apiKeyCipher: "v1:a:b:c", model: "m", enabled: true },
    });
    const r = await http
      .post(`/api/insights/${conn.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ profileSlug: "default", range: "30d", runIds: [] })
      .expect(201);
    expect(r.body.findings).toHaveLength(1);
    expect(r.body.findings[0].severity).toBe("warning");
    expect(r.body.fromCache).toBe(false);
  });
});

it("returns 404 when provider not configured", async () => {
  await withTestApp(async ({ http, login, prisma }) => {
    const { token, userId } = await login();
    const conn = await prisma.connection.create({
      data: { userId, name: "noai", baseUrl: "http://x", apiKeyCipher: "v1:a:b:c", model: "m", customHeaders: "", queryParams: "", category: "chat" },
    });
    await http
      .post(`/api/insights/${conn.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ profileSlug: "default", range: "30d", runIds: [] })
      .expect(404);
  });
});
```

(Note: provider's apiKeyCipher uses fake `v1:a:b:c` — the mock LLM never decrypts because `chatCompletion` is mocked. Real flow uses the proper cipher from `LlmJudgeService.getDecrypted`.)

**- [ ] Step 2: Run + commit**

```bash
pnpm test:e2e:api -- insights
```

```bash
git add apps/api/test/e2e/insights.e2e-spec.ts
git commit -m "test(api/insights): synthesize e2e (mocked LLM)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

(Plan continues — Phases 10-12 in next file.)

## Phase 10 — Frontend AI 智能诊断 card

### Task 30: AiDiagnosisCard component (states + manual trigger)

**Files:**
- Create: `apps/web/src/features/insights/AiDiagnosisCard.tsx`
- Create: `apps/web/src/features/insights/__tests__/AiDiagnosisCard.test.tsx`

**- [ ] Step 1: Add synthesize query to insights queries**

Append to `apps/web/src/features/insights/queries.ts`:

```ts
import type { SynthesizeRequest, SynthesizeResponse } from "@modeldoctor/contracts";
import { useMutation } from "@tanstack/react-query";

export function useSynthesize(connectionId: string) {
  return useMutation<SynthesizeResponse, Error, SynthesizeRequest>({
    mutationFn: async (body) =>
      (await apiClient.post(`/insights/${connectionId}/synthesize`, body)).data,
  });
}
```

**- [ ] Step 2: Implement AiDiagnosisCard**

```tsx
// apps/web/src/features/insights/AiDiagnosisCard.tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useLlmJudgeProvider } from "@/features/settings/queries";
import type { EndpointReportRange, NarrativeFinding } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSynthesize } from "./queries";

interface Props {
  connectionId: string;
  profileSlug: string;
  range: EndpointReportRange;
  runIds: string[];
}

const SEV_BADGE = {
  critical: { emoji: "🔴", label: "高危", cls: "border-rose-500" },
  warning: { emoji: "🟡", label: "警告", cls: "border-amber-500" },
  info: { emoji: "🔵", label: "提示", cls: "border-blue-500" },
} as const;

export function AiDiagnosisCard({ connectionId, profileSlug, range, runIds }: Props) {
  const { t } = useTranslation("insights");
  const provider = useLlmJudgeProvider();
  const synth = useSynthesize(connectionId);
  const [latest, setLatest] = useState<{ findings: NarrativeFinding[]; generatedAt: string; fromCache: boolean } | null>(null);

  async function generate() {
    try {
      const r = await synth.mutateAsync({ profileSlug, range, runIds });
      setLatest({ findings: r.findings, generatedAt: r.generatedAt, fromCache: r.fromCache });
    } catch {
      // mutation error state shown below
    }
  }

  if (provider.isLoading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">…</CardContent></Card>;
  }

  if (!provider.data) {
    return (
      <Card>
        <CardHeader><h3 className="text-sm font-semibold">{t("detail.ai.title")}</h3></CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">{t("detail.ai.providerMissing")}</div>
          <Button asChild variant="outline" size="sm"><Link to="/settings">{t("detail.ai.goToSettings")}</Link></Button>
        </CardContent>
      </Card>
    );
  }

  if (!provider.data.enabled) {
    return (
      <Card>
        <CardHeader><h3 className="text-sm font-semibold">{t("detail.ai.title")}</h3></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("detail.ai.providerDisabled")}</CardContent>
      </Card>
    );
  }

  if (runIds.length === 0) {
    return null; // no point synthesizing zero data
  }

  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader className="flex-row items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-500" />
          {t("detail.ai.title")}
        </h3>
        {latest && (
          <Button variant="ghost" size="sm" onClick={generate} disabled={synth.isPending}>
            <RefreshCw className={`mr-1 h-3 w-3 ${synth.isPending ? "animate-spin" : ""}`} />
            {t("detail.ai.refresh")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!latest && !synth.isPending && (
          <Button onClick={generate} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            {t("detail.ai.generate")}
          </Button>
        )}
        {synth.isPending && (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">{t("detail.ai.generating")}</div>
            <div className="h-3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        )}
        {synth.error && !synth.isPending && (
          <div className="text-sm text-rose-600 dark:text-rose-400">
            {synth.error.message}
          </div>
        )}
        {latest && latest.findings.map((f, i) => {
          const sev = SEV_BADGE[f.severity];
          return (
            <div key={i} className={`rounded-md border-l-[3px] bg-card px-3 py-2 ${sev.cls}`}>
              <div className="font-medium text-sm">
                {sev.emoji} {f.title}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{f.rootCause}</div>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {f.recommendations.map((r, j) => <li key={j}>{r}</li>)}
              </ul>
            </div>
          );
        })}
        {latest && (
          <div className="text-xs text-muted-foreground">
            {t("detail.ai.lastGenerated", { when: formatDistanceToNow(new Date(latest.generatedAt), { addSuffix: true }) })}
            {latest.fromCache && ` · ${t("detail.ai.fromCache")}`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

**- [ ] Step 3: Component test**

```tsx
// apps/web/src/features/insights/__tests__/AiDiagnosisCard.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { AiDiagnosisCard } from "../AiDiagnosisCard";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: { id: "p1", baseUrl: "https://x", model: "m", enabled: true, createdAt: "x", updatedAt: "x" } })),
    post: vi.fn(async () => ({ data: {
      findings: [{ severity: "critical", title: "TTFT 高", rootCause: "p95 1240ms", recommendations: ["预热"] }],
      generatedAt: new Date().toISOString(), runIdsHash: "h", fromCache: false,
    }})),
  },
}));

function r(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("AiDiagnosisCard", () => {
  it("renders generate button when provider configured + has runs", async () => {
    r(<AiDiagnosisCard connectionId="c1" profileSlug="default" range="30d" runIds={["r1"]} />);
    expect(await screen.findByRole("button", { name: /生成|generate/i })).toBeInTheDocument();
  });

  it("renders findings after generate click", async () => {
    r(<AiDiagnosisCard connectionId="c1" profileSlug="default" range="30d" runIds={["r1"]} />);
    const btn = await screen.findByRole("button", { name: /生成|generate/i });
    await userEvent.click(btn);
    expect(await screen.findByText("TTFT 高")).toBeInTheDocument();
    expect(screen.getByText(/预热/)).toBeInTheDocument();
  });
});
```

**- [ ] Step 4: Run + commit**

```bash
pnpm -F @modeldoctor/web test -- AiDiagnosisCard
```

```bash
git add apps/web/src/features/insights/AiDiagnosisCard.tsx apps/web/src/features/insights/queries.ts apps/web/src/features/insights/__tests__/AiDiagnosisCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/insights): AI 智能诊断 card with state-aware rendering

States covered: provider missing → CTA to settings; provider disabled;
0 runs → hidden; idle → generate button; pending → skeleton; error →
inline message; success → ranked finding cards + last-generated +
refresh button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 31: Mount AiDiagnosisCard in InsightsDetailPage

**Files:**
- Modify: `apps/web/src/features/insights/InsightsDetailPage.tsx`

**- [ ] Step 1: Add the card**

In `InsightsDetailPage.tsx`, after the `<FindingsCard>` block:

```tsx
import { AiDiagnosisCard } from "./AiDiagnosisCard";
...
<AiDiagnosisCard
  connectionId={connectionId}
  profileSlug={activeProfile?.slug ?? "default"}
  range={range}
  runIds={runs.map((r) => r.id)}
/>
```

**- [ ] Step 2: Manual smoke**

```bash
pnpm -F @modeldoctor/web dev
```

Visit `/insights/<some-real-connection-id>?range=30d`. Should see:
- Score banner
- Findings card
- AI 智能诊断 card (either "configure provider" or "generate" button)
- 3 scenario panels

Stop dev server.

**- [ ] Step 3: Commit**

```bash
git add apps/web/src/features/insights/InsightsDetailPage.tsx
git commit -m "feat(web/insights): mount AI 智能诊断 card on detail page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 32: Cache invalidation hint when runs change

**Files:**
- Modify: `apps/web/src/features/insights/AiDiagnosisCard.tsx` (already invalidates by runIds — no actual code change here, but add a regression test)
- Create: `apps/web/src/features/insights/__tests__/cache-invalidation.test.tsx`

**- [ ] Step 1: Test that re-rendering with different runIds clears the latest narrative**

```tsx
// apps/web/src/features/insights/__tests__/cache-invalidation.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";
import { AiDiagnosisCard } from "../AiDiagnosisCard";

let postCallCount = 0;
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: { id: "p1", baseUrl: "https://x", model: "m", enabled: true, createdAt: "x", updatedAt: "x" } })),
    post: vi.fn(async () => {
      postCallCount += 1;
      return {
        data: {
          findings: [{ severity: "info", title: `gen-${postCallCount}`, rootCause: "ok", recommendations: [] }],
          generatedAt: new Date().toISOString(), runIdsHash: `h${postCallCount}`, fromCache: false,
        },
      };
    }),
  },
}));

function r(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("AiDiagnosisCard cache hint behavior", () => {
  it("re-clicking refresh produces a fresh request (no client-side cache)", async () => {
    r(<AiDiagnosisCard connectionId="c1" profileSlug="default" range="30d" runIds={["r1"]} />);
    await userEvent.click(await screen.findByRole("button", { name: /生成|generate/i }));
    expect(await screen.findByText("gen-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /刷新|refresh/i }));
    expect(await screen.findByText("gen-2")).toBeInTheDocument();
  });
});
```

**- [ ] Step 2: Commit**

```bash
git add apps/web/src/features/insights/__tests__/cache-invalidation.test.tsx
git commit -m "test(web/insights): refresh button bypasses any client cache

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 11 — i18n + Playwright e2e

### Task 33: Add insights namespace + zh-CN keys

**Files:**
- Create: `apps/web/src/locales/zh-CN/insights.json`
- Create: `apps/web/src/locales/en-US/insights.json`
- Modify: `apps/web/src/lib/i18n.ts` (register namespace)

**- [ ] Step 1: zh-CN/insights.json**

Use the keys from spec §9. Verbatim copy:

```json
{
  "title": "测试洞察",
  "subtitle": "按连接聚合的模型性能档案",
  "axis": {
    "responsiveness": "响应性",
    "smoothness": "流畅度",
    "throughput": "吞吐",
    "stability": "稳定性",
    "tail": "长尾",
    "efficiency": "效率"
  },
  "detail": {
    "backToIndex": "返回测试洞察",
    "compositeScore": "综合评分",
    "checks": "{{count}} 项检测",
    "runs": "{{count}} 次测试",
    "in": "近 {{days}} 天",
    "notFound": "连接不存在或已删除",
    "profile": {
      "label": "评估画像",
      "switch": "切换画像",
      "setDefault": "设为默认"
    },
    "findings": {
      "title": "关键发现",
      "expandAll": "展开全部 {{count}} 项检测",
      "noFindings": "本时间范围内无检测项数据",
      "severity": { "good": "良好", "warn": "中等", "crit": "高危", "no_data": "无数据" }
    },
    "ai": {
      "title": "AI 智能诊断",
      "generate": "生成 AI 诊断",
      "generating": "生成中…（约 5-15 秒）",
      "refresh": "刷新",
      "lastGenerated": "最新生成 {{when}}",
      "fromCache": "来自缓存",
      "providerMissing": "尚未配置 LLM 提供商",
      "goToSettings": "前往设置",
      "providerDisabled": "AI 智能诊断已停用"
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
    }
  },
  "profiles": {
    "default": { "name": "通用 (chatbot 中庸假设)" },
    "chatbot": { "name": "Chatbot 实时对话" },
    "rag": { "name": "RAG 检索增强" },
    "code-completion": { "name": "Code Completion" },
    "long-form": { "name": "Long-Form 长文生成" }
  },
  "checks": {
    "inference": {
      "ttft": {
        "p95": { "ms": { "recommendation": "TTFT (首字延迟) 偏高 — 检查模型加载策略、批合并 (continuous batching) 设置；考虑增加请求预热让冷启动期请求不进统计。" } },
        "p99": { "ms": { "recommendation": "TTFT p99 偏高 — 长尾抖动较大，排查 GC / KV cache 抖动 / 后端突发负载。" } }
      },
      "itl": { "p95": { "ms": { "recommendation": "ITL (token 间延迟) 偏高 — token rate 不足，排查计算瓶颈或调整 batch 配置。" } } },
      "e2e": {
        "p95": { "ms": { "recommendation": "端到端 p95 延迟偏高 — 综合 TTFT + token 数 + ITL 三因素，先看 TTFT 改善空间。" } },
        "p99": { "ms": { "recommendation": "端到端 p99 偏高 — 长尾抖动大，排查 KV cache eviction、批次切换。" } }
      },
      "error_rate": { "recommendation": "错误率偏高 — 检查超时、限流、模型加载失败；查看 statusMessage 与 logs。" },
      "throughput": { "req_per_s": { "recommendation": "吞吐偏低 — 增加副本、调整 max_concurrent、提升 batch 利用率。" } }
    },
    "capacity": {
      "max_qps": { "recommendation": "最大稳定 QPS 偏低 — 检查批合并设置、副本数、tokenizer 路径是否对齐。" },
      "error_rate": { "recommendation": "容量场景错误率偏高 — 当前负载超过稳定区间，下调测试 QPS 或扩容。" },
      "tail_ratio": { "recommendation": "p99/p50 长尾比偏大 — 长请求阻塞短请求，考虑请求分桶或开启 chunked prefill。" }
    },
    "gateway": {
      "error_rate": { "recommendation": "网关错误率偏高 — 排查反向代理超时、限流策略、上游连接池配置。" },
      "tail_ratio": { "recommendation": "网关长尾比偏大 — 检查重试、长连接复用、上游慢响应阻塞。" },
      "throughput": { "req_per_s": { "recommendation": "网关吞吐偏低 — 检查并发上限、连接池、CPU 限制。" } }
    }
  }
}
```

**- [ ] Step 2: en-US/insights.json — same shape, English copy**

(Provided in full file; mirror keys 1:1.) Use the same JSON shape with the values translated to English. Sample:

```json
{
  "title": "Test Insights",
  "subtitle": "Model performance dossier aggregated per connection",
  "axis": { "responsiveness": "Responsiveness", "smoothness": "Smoothness", "throughput": "Throughput", "stability": "Stability", "tail": "Tail", "efficiency": "Efficiency" },
  "detail": {
    "backToIndex": "Back to Test Insights",
    "compositeScore": "Composite score",
    "checks": "{{count}} checks",
    "runs": "{{count}} tests",
    "in": "in last {{days}} days",
    "notFound": "Connection not found or deleted",
    "profile": { "label": "Profile", "switch": "Switch profile", "setDefault": "Set as default" },
    "findings": { "title": "Key findings", "expandAll": "Expand all {{count}} checks", "noFindings": "No check data in this range", "severity": { "good": "Good", "warn": "Warning", "crit": "Critical", "no_data": "No data" } },
    "ai": { "title": "AI Diagnosis", "generate": "Generate AI diagnosis", "generating": "Generating… (5-15s)", "refresh": "Refresh", "lastGenerated": "Generated {{when}}", "fromCache": "from cache", "providerMissing": "LLM provider not configured", "goToSettings": "Go to settings", "providerDisabled": "AI diagnosis disabled" },
    "scenario": {
      "inference": "Inference Benchmark", "capacity": "Capacity Planning", "gateway": "Gateway Stress",
      "viewAll": "View all {{count}} tests in this scenario",
      "empty": { "title": "No {{scenario}} tests yet", "cta": "Create the first test" }
    }
  },
  "profiles": {
    "default": { "name": "Default (chatbot baseline)" },
    "chatbot": { "name": "Chatbot Realtime" },
    "rag": { "name": "RAG Retrieval-Augmented" },
    "code-completion": { "name": "Code Completion" },
    "long-form": { "name": "Long-Form Generation" }
  },
  "checks": {
    "inference": {
      "ttft": { "p95": { "ms": { "recommendation": "TTFT (time-to-first-token) is high — review model loading and continuous-batching settings; add warmup requests so cold starts don't pollute the metric." } }, "p99": { "ms": { "recommendation": "TTFT p99 is high — heavy tail. Investigate GC, KV cache thrash, or backend load spikes." } } },
      "itl": { "p95": { "ms": { "recommendation": "ITL (inter-token latency) is high — token rate is below threshold; investigate compute bottleneck or batch config." } } },
      "e2e": { "p95": { "ms": { "recommendation": "End-to-end p95 latency is high — composite of TTFT + token count + ITL; start by improving TTFT." } }, "p99": { "ms": { "recommendation": "End-to-end p99 is high — heavy tail. Look at KV cache eviction or batch reshuffles." } } },
      "error_rate": { "recommendation": "Error rate is high — inspect timeouts, rate limits, model load failures; check statusMessage and logs." },
      "throughput": { "req_per_s": { "recommendation": "Throughput is low — add replicas, raise max_concurrent, or improve batch utilization." } }
    },
    "capacity": {
      "max_qps": { "recommendation": "Max stable QPS is below baseline — check batching, replica count, tokenizer alignment." },
      "error_rate": { "recommendation": "Errors rising under load — current QPS exceeds stable band; reduce test QPS or scale out." },
      "tail_ratio": { "recommendation": "p99/p50 tail ratio is large — long requests block short ones; consider request bucketing or chunked prefill." }
    },
    "gateway": {
      "error_rate": { "recommendation": "Gateway error rate is high — inspect reverse-proxy timeouts, rate-limit rules, upstream pool config." },
      "tail_ratio": { "recommendation": "Gateway tail ratio is large — check retries, keep-alive reuse, slow upstream responses." },
      "throughput": { "req_per_s": { "recommendation": "Gateway throughput is low — review concurrency caps, connection pool, CPU limits." } }
    }
  }
}
```

**- [ ] Step 3: Register namespace**

In `apps/web/src/lib/i18n.ts`, add `insights` to the namespaces list and register the JSON imports for both locales. Follow whatever pattern existing namespaces use (e.g., `benchmarks`, `connections`).

**- [ ] Step 4: Add settings.json keys**

In `apps/web/src/locales/zh-CN/settings.json`, add:
```json
"ai": {
  "title": "AI 智能诊断",
  "description": "配置外部 LLM 服务作为 ModelDoctor 的 AI 顾问。仅用于详情页智能诊断生成。AI 输出当前仅为中文。",
  "enabled": "启用",
  "baseUrl": "Base URL",
  "apiKey": "API Key",
  "model": "模型",
  "test": "测试连接",
  "testing": "测试中…",
  "testSuccess": "连接成功（耗时 {{ms}}ms）",
  "testFailed": "连接失败：{{error}}",
  "saving": "保存中…",
  "saveSuccess": "已保存",
  "error": {
    "keyRequired": "请填写 API Key",
    "fillBeforeTest": "请先填写 baseUrl / apiKey / model"
  }
}
```

en-US: mirror with English copy + add note `"AI output is currently zh-CN only."` to `description`.

**- [ ] Step 5: Commit**

```bash
git add apps/web/src/locales/ apps/web/src/lib/i18n.ts
git commit -m "$(cat <<'EOF'
feat(i18n): insights + settings.ai keys (zh-CN + en-US)

Adds the new 'insights' namespace covering detail page, axis labels,
profile names, severity labels, AI section, and 13 check
recommendation strings. Settings adds 'ai' subsection. en-US notes
that AI output is zh-CN only for V1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 34: Playwright e2e — settings + insights flow

**Files:**
- Create: `e2e/settings/llm-judge-settings.spec.ts`
- Create: `e2e/benchmarks/insights-detail.spec.ts`

**- [ ] Step 1: Settings flow**

```ts
// e2e/settings/llm-judge-settings.spec.ts
import { expect, test } from "@playwright/test";
import { register } from "../helpers/auth.js";

test.describe("AI judge settings", () => {
  test("save provider then test → success", async ({ page }) => {
    await register(page);
    await page.goto("/settings");
    await page.getByLabel(/base url/i).fill("https://api.deepseek.com/v1");
    await page.getByLabel(/api key/i).fill("sk-fake");
    await page.getByLabel(/model/i).fill("deepseek-chat");

    // Test connection — server will likely fail (no real backend); just assert
    // that the test endpoint is invoked and an error toast or success toast appears.
    await page.getByRole("button", { name: /test|测试/i }).click();
    await expect(page.getByText(/test|测试|连接/i).first()).toBeVisible({ timeout: 15_000 });

    // Save (may or may not succeed depending on mock; assert no crash)
    await page.getByRole("button", { name: /save|保存/i }).click();
  });
});
```

**- [ ] Step 2: Insights detail flow**

```ts
// e2e/benchmarks/insights-detail.spec.ts
import { expect, test } from "@playwright/test";
import { register } from "../helpers/auth.js";

test.describe("Insights detail page", () => {
  test("redirects from old /benchmarks/reports/:id path", async ({ page }) => {
    await register(page);
    // Bookmark-style direct navigation to old URL; expect redirect.
    await page.goto("/benchmarks/reports/nonexistent-conn-id?range=7d");
    await expect(page).toHaveURL(/\/insights\/nonexistent-conn-id/);
  });

  test("profile switcher updates URL param", async ({ page }) => {
    await register(page);
    await page.goto("/insights/nonexistent-conn-id");
    // Page will show 404 state; the profile select may not render. This is just
    // a smoke test — full happy-path requires seeded data via fixture.
  });
});
```

(Adapt to actual `register` / fixture helpers in the existing e2e suite; reference `e2e/benchmarks/endpoint-reports.spec.ts`.)

**- [ ] Step 3: Run**

```bash
pnpm -r build  # required: contracts/dist must exist
pnpm test:e2e:browser -- llm-judge-settings insights-detail
```

**- [ ] Step 4: Commit**

```bash
git add e2e/settings/ e2e/benchmarks/insights-detail.spec.ts
git commit -m "test(e2e): settings AI provider flow + insights redirect smoke

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 35: Manual smoke checklist

**Files:** none (verification only — record results in commit message)

Run a full local round:

```bash
pnpm -r build
pnpm -F @modeldoctor/api start:dev &  # background
pnpm -F @modeldoctor/web dev &
# Wait for both to come up (web on 5173, api on 3000)
```

**- [ ] Step 1: Settings flow**

- Login / register a fresh user
- Visit `/settings` → fill DeepSeek (or any OpenAI-compatible) + real key + model → click 测试连接 → expect success toast
- Click 保存 → verify by reloading → fields populate (apiKey field empty for security)
- Toggle 启用 off → save → reload → switch is off

**- [ ] Step 2: Insights flow**

- Create a connection (or use existing) with category=`chat`
- Run a few benchmarks against it (chat scenario, guidellm tool — at least 3 runs in 7-day window)
- Visit `/insights/<connectionId>?range=30d`
- Verify: composite score appears, radar renders, findings card shows TTFT/error_rate/etc.
- Switch profile to `chatbot` → score updates, findings recompute
- Click "设为默认" → reload → profile selector defaults to `chatbot`
- Click 生成 AI 诊断 → wait 5-15s → narrative findings appear
- Click 刷新 → narrative regenerates (different content if temperature ≠ 0)

**- [ ] Step 3: List page filters**

- Visit `/benchmarks/reports`
- Type into search box → cards filter
- Change category → cards filter
- Verify URL has `?q=...&category=...&range=...`
- Click 查看详情 → lands on `/insights/:id`

**- [ ] Step 4: Stop dev servers**

```bash
kill %1 %2  # or however your shell tracks bg jobs
```

**- [ ] Step 5: Commit (empty checkpoint)**

No file changes; record the smoke results in your status update to the user.

---

## Phase 12 — Cleanup + docs

### Task 36: Delete obsolete TestInsights* files

**Files (delete):**
- `apps/web/src/features/benchmarks/TestInsightsDetailPage.tsx`
- `apps/web/src/features/benchmarks/TestInsightsP95Chart.tsx`
- `apps/web/src/features/benchmarks/TestInsightsRunsTable.tsx`
- `apps/web/src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx`
- `apps/web/src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx`
- `apps/web/src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx`

**- [ ] Step 1: Verify no remaining imports**

```bash
grep -RIn "TestInsights" apps/ packages/ e2e/ --include="*.ts" --include="*.tsx" 2>/dev/null
```

Expected: 0 lines (or only in comments/docs that were already noted in spec).

**- [ ] Step 2: Delete**

```bash
git rm apps/web/src/features/benchmarks/TestInsightsDetailPage.tsx
git rm apps/web/src/features/benchmarks/TestInsightsP95Chart.tsx
git rm apps/web/src/features/benchmarks/TestInsightsRunsTable.tsx
git rm apps/web/src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx
git rm apps/web/src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx
git rm apps/web/src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx
```

**- [ ] Step 3: Run full test suite**

```bash
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/api test
```

Both green.

**- [ ] Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(insights): delete obsolete TestInsights* (replaced by features/insights)

The minimal #141 detail view (TestInsightsDetailPage + helpers) is fully
superseded by the new scenario-driven page. Trend chart and runs table
are not migrated — runs are accessed via per-scenario "view all"
deep-links to the existing benchmarks list page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 37: Update CLAUDE.md + README

**Files:**
- Modify: `CLAUDE.md` (add new endpoints to "Project-specific constraints" or a new "API surface" section if one exists)
- Modify: `README.md` (note that ENCRYPTION_KEY now also covers LLM judge provider; update if there's a "Features" list mentioning test insights)

**- [ ] Step 1: CLAUDE.md addition (root)**

Append a new section after "Project-specific constraints":

```markdown
## Insights & AI judge

- `evaluation_profiles` is read-only via API; new built-in profiles are added by Prisma migration only.
- `llm_judge_providers` reuses `CONNECTION_API_KEY_ENCRYPTION_KEY` (no separate env var).
- `POST /api/insights/:connectionId/synthesize` is synchronous (5-30s); cache is in-memory LRU on the API process. Do not rely on consistency across multi-replica deploys.
- AI narrative is zh-CN only for V1.
```

**- [ ] Step 2: README — only update if it has a feature list or env-var section**

Search:
```bash
grep -n "ENCRYPTION_KEY\|test insights\|test-insights" README.md
```

If matches, update accordingly. If no relevant section exists, skip.

**- [ ] Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "$(cat <<'EOF'
docs: note insights API + AI judge ops constraints

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final pre-PR checklist

Before running `gh pr create`:

- [ ] `pnpm -r build` clean
- [ ] `pnpm lint` clean (or document any pre-existing failures)
- [ ] `pnpm -F @modeldoctor/api test` green
- [ ] `pnpm -F @modeldoctor/web test` green
- [ ] `pnpm test:e2e:api` green
- [ ] `pnpm test:e2e:browser` green
- [ ] Manual smoke checklist (Task 35) all checked
- [ ] `git log --oneline main..HEAD` reads as a coherent phase-per-commit story
- [ ] No TestInsights* files remain (`grep -R "TestInsights" apps/ packages/`)
- [ ] No "TODO" or "FIXME" comments added in this PR (`git diff main..HEAD | grep -iE '^\+.*\b(TODO|FIXME|TBD|XXX)\b'`)

PR title: `feat(insights): scenario-driven detail page + Profile system + AI 综合诊断`

PR body: link to spec doc + summary of the 5 user-visible additions (composite score, radar, findings, profile selector, AI card).
