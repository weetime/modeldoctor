/**
 * Prisma seed — idempotent upsert of built-in / official content that must
 * exist in every environment (dev, CI, prod).
 *
 * Runs automatically after `prisma migrate dev` and `prisma migrate reset`.
 * In prod, the deploy pipeline must invoke `pnpm prisma db seed` explicitly
 * after `prisma migrate deploy` (deploy does not auto-seed by design).
 *
 * Every row is validated through its zod schema before reaching the DB:
 *   - evaluation_profiles  →  profileRulesSchema  (packages/contracts)
 *   - benchmark_templates  →  guidellm / genai-perf params + scenario
 *                             constraints (packages/tool-adapters)
 *
 * Adding a new built-in:
 *   1. Append to EVALUATION_PROFILES or BENCHMARK_TEMPLATES.
 *   2. Pick a stable `id` (and `slug` for profiles); never reuse an existing one.
 *   3. Run `pnpm -F @modeldoctor/api db:seed` to verify it upserts cleanly.
 *
 * Editing an existing built-in: change the seed object in place. Next seed
 * run will UPDATE the row. The migration history is untouched.
 *
 * Removing a built-in: delete from this file AND write a one-off migration
 * with `DELETE FROM ... WHERE id = '...'` (seed.ts only inserts/updates).
 */

import { evaluationSampleSchema, profileRulesSchema } from "@modeldoctor/contracts";
import {
  applyScenarioConstraints,
  genaiPerfParamsSchema,
  guidellmParamsSchema,
} from "@modeldoctor/tool-adapters";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// System seed user
//
// Built-in evaluation sets are owned by this system user so the FK
// constraint on evaluations.user_id is satisfied in every environment.
// The account is not meant for human login — it has no password hash that
// can pass bcrypt verification.
// ---------------------------------------------------------------------------

const SEED_SYSTEM_USER_ID = "usr_system_seed_00000000000";

async function seedSystemUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: SEED_SYSTEM_USER_ID },
    update: {},
    create: {
      id: SEED_SYSTEM_USER_ID,
      email: "system-seed@modeldoctor.internal",
      passwordHash: "!locked", // deliberately invalid — cannot be used to log in
      roles: ["system"],
      displayName: "System Seed",
    },
  });
}

// ---------------------------------------------------------------------------
// Evaluation profiles (5 built-ins)
//
// Snapshot of the 5 rows that used to live in
// 20260507063541_add_evaluation_profiles_and_llm_judge migration's INSERT.
// IDs preserved so existing dev envs that already had these rows upsert
// onto themselves cleanly.
// ---------------------------------------------------------------------------

interface EvaluationProfileSeed {
  id: string;
  slug: string;
  name: string;
  nameKey: string;
  description: string;
  rules: unknown;
  source: string | null;
}

const COMMON_THROUGHPUT_AND_CAPACITY_CHECKS = {
  "inference.throughput.req_per_s": { warn: 10, crit: 5, weight: 0.5 },
  "capacity.max_qps": { warn: 20, crit: 10, weight: 1.0 },
  "capacity.error_rate": { warn: 0.05, crit: 0.1, weight: 1.0 },
  "capacity.tail_ratio": { warn: 5.0, crit: 10.0, weight: 0.7 },
  "gateway.error_rate": { warn: 0.005, crit: 0.02, weight: 1.0 },
  "gateway.tail_ratio": { warn: 5.0, crit: 10.0, weight: 1.0 },
  "gateway.throughput.req_per_s": { warn: 50, crit: 20, weight: 0.7 },
} as const;

const EVALUATION_PROFILES: EvaluationProfileSeed[] = [
  {
    id: "clxprofdefault0000000000",
    slug: "default",
    name: "通用",
    nameKey: "profiles.default.name",
    description: "通用基线 — 适合大多数 LLM 服务的中庸阈值",
    rules: {
      checks: {
        "inference.ttft.p95.ms": { warn: 500, crit: 1000, weight: 1.0 },
        "inference.ttft.p99.ms": { warn: 800, crit: 2000, weight: 0.5 },
        "inference.itl.p95.ms": { warn: 60, crit: 120, weight: 0.7 },
        "inference.e2e.p95.ms": { warn: 3000, crit: 8000, weight: 0.7 },
        "inference.e2e.p99.ms": { warn: 5000, crit: 15000, weight: 0.5 },
        "inference.error_rate": { warn: 0.01, crit: 0.05, weight: 1.0 },
        ...COMMON_THROUGHPUT_AND_CAPACITY_CHECKS,
      },
    },
    source:
      "基于 OpenAI Console / Anthropic Playground 公开 SLO + vLLM 官方 benchmark 中位数（vLLM v0.6.x release notes）综合得出的 chatbot 中庸默认。",
  },
  {
    id: "clxprofchatbot0000000000",
    slug: "chatbot",
    name: "Chatbot 实时对话",
    nameKey: "profiles.chatbot.name",
    description: "强调 TTFT — 适合实时聊天场景",
    rules: {
      checks: {
        "inference.ttft.p95.ms": { warn: 300, crit: 800, weight: 1.5 },
        "inference.ttft.p99.ms": { warn: 500, crit: 1500, weight: 0.7 },
        "inference.itl.p95.ms": { warn: 50, crit: 100, weight: 0.7 },
        "inference.e2e.p95.ms": { warn: 3000, crit: 8000, weight: 0.7 },
        "inference.e2e.p99.ms": { warn: 5000, crit: 15000, weight: 0.5 },
        "inference.error_rate": { warn: 0.01, crit: 0.05, weight: 1.0 },
        ...COMMON_THROUGHPUT_AND_CAPACITY_CHECKS,
      },
      axisWeights: { responsiveness: 1.5 },
    },
    source:
      "Chatbot 用户对首字延迟的主观感知阈值（<300ms 优秀, <800ms 可接受）。基于 OpenAI Playground 实测 + Anthropic Console SLO。",
  },
  {
    id: "clxprofrag00000000000000",
    slug: "rag",
    name: "RAG 检索增强",
    nameKey: "profiles.rag.name",
    description: "容忍 TTFT — 用户已习惯检索延迟",
    rules: {
      checks: {
        "inference.ttft.p95.ms": { warn: 1500, crit: 3000, weight: 1.0 },
        "inference.ttft.p99.ms": { warn: 2500, crit: 5000, weight: 0.5 },
        "inference.itl.p95.ms": { warn: 60, crit: 120, weight: 0.7 },
        "inference.e2e.p95.ms": { warn: 5000, crit: 12000, weight: 0.7 },
        "inference.e2e.p99.ms": { warn: 8000, crit: 20000, weight: 0.5 },
        "inference.error_rate": { warn: 0.01, crit: 0.05, weight: 1.0 },
        ...COMMON_THROUGHPUT_AND_CAPACITY_CHECKS,
      },
    },
    source:
      "RAG 场景：用户预期检索阶段延迟，TTFT 阈值放宽至 1500ms warn / 3000ms crit。LangSmith / Pinecone 公开 RAG benchmark 数据。",
  },
  {
    id: "clxprofcodecomp000000000",
    slug: "code-completion",
    name: "Code Completion 代码补全",
    nameKey: "profiles.code-completion.name",
    description: "极致 TTFT — 必须比键入快",
    rules: {
      checks: {
        "inference.ttft.p95.ms": { warn: 100, crit: 200, weight: 2.0 },
        "inference.ttft.p99.ms": { warn: 150, crit: 350, weight: 1.0 },
        "inference.itl.p95.ms": { warn: 30, crit: 60, weight: 1.0 },
        "inference.e2e.p95.ms": { warn: 1000, crit: 3000, weight: 0.7 },
        "inference.e2e.p99.ms": { warn: 2000, crit: 5000, weight: 0.5 },
        "inference.error_rate": { warn: 0.01, crit: 0.05, weight: 1.0 },
        ...COMMON_THROUGHPUT_AND_CAPACITY_CHECKS,
      },
      axisWeights: { responsiveness: 2.0 },
    },
    source:
      "Code completion：响应慢于打字节奏即不可用。Cursor / Copilot 公开数据：TTFT <100ms 优秀, <200ms 可接受。",
  },
  {
    id: "clxproflongform000000000",
    slug: "long-form",
    name: "Long-Form 长文生成",
    nameKey: "profiles.long-form.name",
    description: "强调吞吐 + 容错",
    rules: {
      checks: {
        "inference.ttft.p95.ms": { warn: 1000, crit: 3000, weight: 0.7 },
        "inference.ttft.p99.ms": { warn: 1500, crit: 5000, weight: 0.3 },
        "inference.itl.p95.ms": { warn: 80, crit: 200, weight: 1.0 },
        "inference.e2e.p95.ms": { warn: 15000, crit: 60000, weight: 0.5 },
        "inference.e2e.p99.ms": { warn: 30000, crit: 120000, weight: 0.3 },
        "inference.error_rate": { warn: 0.005, crit: 0.02, weight: 1.5 },
        ...COMMON_THROUGHPUT_AND_CAPACITY_CHECKS,
      },
      axisWeights: { throughput: 1.5 },
    },
    source: "长文场景：长输出对单次失败的容忍度低，error_rate 阈值更严；TTFT 容忍。",
  },
];

// ---------------------------------------------------------------------------
// Official benchmark templates (10 — all inference scenario)
//
// Rationale + parameter sourcing for each:
//   docs/superpowers/specs/2026-05-12-official-benchmark-templates-design.md
//
// All configs are validated through:
//   - the adapter's own zod schema (guidellm | genai-perf)
//   - applyScenarioConstraints("inference", tool)  (narrows rateType etc.)
// ---------------------------------------------------------------------------

type Tool = "guidellm" | "genai-perf";
interface BenchmarkTemplateSeed {
  id: string;
  name: string;
  description: string;
  scenario: "inference";
  tool: Tool;
  config: unknown;
  tags: string[];
}

const BENCHMARK_TEMPLATES: BenchmarkTemplateSeed[] = [
  {
    id: "tpl_official_chat_standard",
    name: "通用对话 · 标准",
    description:
      "通用对话基线，对齐 GuideLLM 上游 chat.json（input 512 / output 256）。10 RPS 泊松、1000 次请求，先看 TTFT/TPOT p95 水位。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 512,
      datasetOutputTokens: 256,
      rateType: "poisson",
      requestRate: 10,
      totalRequests: 1000,
      maxDurationSeconds: 300,
      maxConcurrency: 100,
      validateBackend: false,
    },
    tags: ["chat", "baseline", "guidellm-upstream"],
  },
  {
    id: "tpl_official_rag_standard",
    name: "RAG · 检索增强",
    description:
      "检索增强对话形状，对齐 GuideLLM 上游 rag.json（input 4096 / output 512）。5 RPS 泊松、500 次请求，长输入压 TTFT/prefill。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "long_context",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 4096,
      datasetOutputTokens: 512,
      rateType: "poisson",
      requestRate: 5,
      totalRequests: 500,
      maxDurationSeconds: 600,
      maxConcurrency: 64,
      validateBackend: false,
    },
    tags: ["rag", "long-input", "guidellm-upstream"],
  },
  {
    id: "tpl_official_vllm_default_baseline",
    name: "vLLM 兼容基线（约定值）",
    description:
      "对齐 vLLM RandomDataset 代码常量 input=1024 / output=128。注意这是约定值不是真实分布——仅用于跨工具横评对账。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "custom",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      rateType: "throughput",
      requestRate: 0,
      totalRequests: 1000,
      maxDurationSeconds: 600,
      maxConcurrency: 64,
      validateBackend: false,
    },
    tags: ["baseline", "vllm-default", "synthetic"],
  },
  {
    id: "tpl_official_production_chat_azure_2024",
    name: "生产对话流量（Azure 2024）",
    description:
      "锚定 Azure LLM Inference Trace 2024 conv（p50 input 967 / p50 output 41）。input 1000 / output 100，30 RPS 泊松对齐单实例量级。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "custom",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 1000,
      datasetOutputTokens: 100,
      rateType: "poisson",
      requestRate: 30,
      totalRequests: 3000,
      maxDurationSeconds: 600,
      maxConcurrency: 200,
      validateBackend: false,
    },
    tags: ["chat", "production-trace", "azure-2024"],
  },
  {
    id: "tpl_official_copilot_code_completion_azure_2024",
    name: "Copilot 代码补全（Azure 2024）",
    description:
      "锚定 Azure 2024 code 服务（p50 input 1976 / p50 output 9）。极短输出、几乎纯 prefill，重点看 TTFT p99（补全要早于下一键）。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "custom",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 2000,
      datasetOutputTokens: 20,
      rateType: "poisson",
      requestRate: 30,
      totalRequests: 3000,
      maxDurationSeconds: 600,
      maxConcurrency: 200,
      validateBackend: false,
    },
    tags: ["code-completion", "production-trace", "azure-2024", "prefill-dominated"],
  },
  {
    id: "tpl_official_long_doc_summarization",
    name: "长文档摘要",
    description:
      "长文档摘要：input 8000 / output 500，synchronous 顺序发送 200 次。主测 TTFT + KV 内存余量——长上下文常 OOM 而不是慢。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "long_context",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 8000,
      datasetOutputTokens: 500,
      rateType: "synchronous",
      requestRate: 0,
      totalRequests: 200,
      maxDurationSeconds: 1800,
      maxConcurrency: 1,
      validateBackend: false,
    },
    tags: ["summarization", "long-context", "memory-bound"],
  },
  {
    id: "tpl_official_long_context_chat_mooncake",
    name: "长上下文对话（Mooncake）",
    description:
      "锚定 Mooncake FAST'25 conv trace（p50 6909 / 350，40% prefix-cache 命中）。input 6000 / output 350。注意：我们 stateless 重放测不到 KV 复用收益，TTFT 是悲观上界。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "long_context",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 6000,
      datasetOutputTokens: 350,
      rateType: "poisson",
      requestRate: 5,
      totalRequests: 500,
      maxDurationSeconds: 1200,
      maxConcurrency: 32,
      validateBackend: false,
    },
    tags: ["chat", "long-context", "production-trace", "mooncake"],
  },
  {
    id: "tpl_official_reasoning_output_heavy",
    name: "推理 · 输出密集（CoT）",
    description:
      "推理/长 CoT 形态：input 300 / output 1500（全集唯一 output > input）。覆盖 o1、R1 类推理模型，主测 TPOT 与输出 tok/s（decode-bound）。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "generation_heavy",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 300,
      datasetOutputTokens: 1500,
      rateType: "poisson",
      requestRate: 5,
      totalRequests: 500,
      maxDurationSeconds: 900,
      maxConcurrency: 32,
      validateBackend: false,
    },
    tags: ["reasoning", "cot", "decode-bound", "generation-heavy"],
  },
  {
    id: "tpl_official_agent_tool_use_mooncake",
    name: "Agent · Tool 调用（Mooncake）",
    description:
      "锚定 Mooncake tool&agent trace（p50 6346 / 30，p95 600——bimodal）。input 6000 / output 50，长 system prompt + 短 JSON 输出。",
    scenario: "inference",
    tool: "guidellm",
    config: {
      profile: "long_context",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 6000,
      datasetOutputTokens: 50,
      rateType: "poisson",
      requestRate: 10,
      totalRequests: 1000,
      maxDurationSeconds: 900,
      maxConcurrency: 64,
      validateBackend: false,
    },
    tags: ["agent", "tool-use", "production-trace", "mooncake", "long-input"],
  },
  {
    id: "tpl_official_embeddings_high_throughput",
    name: "嵌入服务高吞吐",
    description:
      "嵌入服务压测：endpoint=embeddings，input 256 tokens，并发 64、2000 次请求。无生成、非流式，主测 RPS 与 p99 latency。",
    scenario: "inference",
    tool: "genai-perf",
    config: {
      endpointType: "embeddings",
      numPrompts: 2000,
      concurrency: 64,
      inputTokensMean: 256,
      inputTokensStddev: 0,
      streaming: false,
    },
    tags: ["embeddings", "non-generative", "high-throughput"],
  },
];

// ---------------------------------------------------------------------------
// Upsert logic
// ---------------------------------------------------------------------------

async function seedEvaluationProfiles(): Promise<void> {
  for (const p of EVALUATION_PROFILES) {
    // Use the zod-parsed result, not the raw input, so that any future
    // `.transform()` / `.default()` on profileRulesSchema is preserved
    // when the row hits the DB.
    const validatedRules = profileRulesSchema.parse(p.rules);
    // Keyed by `slug` (not `id`) because slug is the domain-stable
    // identifier and is uniquely constrained; this also avoids a
    // unique-violation if someone manually reset `id` while keeping
    // slug stable. `update` deliberately omits `id` and `slug` (both
    // immutable post-create).
    await prisma.evaluationProfile.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        nameKey: p.nameKey,
        description: p.description,
        rules: validatedRules as Prisma.InputJsonValue,
        source: p.source,
        isBuiltin: true,
      },
      create: {
        id: p.id,
        slug: p.slug,
        name: p.name,
        nameKey: p.nameKey,
        description: p.description,
        rules: validatedRules as Prisma.InputJsonValue,
        source: p.source,
        isBuiltin: true,
      },
    });
  }
}

async function seedBenchmarkTemplates(): Promise<void> {
  for (const t of BENCHMARK_TEMPLATES) {
    const base = t.tool === "guidellm" ? guidellmParamsSchema : genaiPerfParamsSchema;
    const validatedBase = base.parse(t.config);
    // Apply scenario-level constraints uniformly across tools. For
    // (inference, genai-perf) this is a no-op — the scenario's
    // paramsConstraints map has no genai-perf entry, so
    // applyScenarioConstraints returns the bare adapter schema and
    // re-parses the same shape. We still call it so the invariant
    // "all official templates round-trip through scenario constraints"
    // holds regardless of tool.
    const validatedConfig = applyScenarioConstraints(t.scenario, t.tool).parse(validatedBase);
    await prisma.benchmarkTemplate.upsert({
      where: { id: t.id },
      update: {
        name: t.name,
        description: t.description,
        scenario: t.scenario,
        tool: t.tool,
        config: validatedConfig as Prisma.InputJsonValue,
        tags: t.tags,
        isOfficial: true,
      },
      create: {
        id: t.id,
        name: t.name,
        description: t.description,
        scenario: t.scenario,
        tool: t.tool,
        config: validatedConfig as Prisma.InputJsonValue,
        tags: t.tags,
        isOfficial: true,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Quality Gate built-in evaluation sets
// ---------------------------------------------------------------------------

const builtInEvaluationSamples = [
  {
    id: "smp_qg_demo_01",
    idx: 0,
    prompt: "客户问：你们退货流程是多久？请用一句话回答。",
    expected: "通常 7 个工作日内完成退款。",
    judgeConfig: { kind: "contains", substrings: ["7", "退"], mode: "all", caseSensitive: false },
  },
  {
    id: "smp_qg_demo_02",
    idx: 1,
    prompt: "翻译为英文：你好世界",
    expected: "Hello, world",
    judgeConfig: { kind: "exact-match", caseSensitive: false, trim: true },
  },
  {
    id: "smp_qg_demo_03",
    idx: 2,
    prompt: "用 JSON 返回客户姓名'张三'和年龄 30，仅输出 JSON 对象不加 markdown。",
    expected: '{"name":"张三","age":30}',
    judgeConfig: {
      kind: "regex",
      pattern: "\"name\"\\s*:\\s*\"张三\".*\"age\"\\s*:\\s*30",
      flags: "s",
    },
  },
  {
    id: "smp_qg_demo_04",
    idx: 3,
    prompt: "客户抱怨快递太慢，请安抚客户并给出补救建议（2-3 句）。",
    expected: "认可客户不满；说明已加急；给出补偿（券或加速）；语气真诚。",
    judgeConfig: {
      kind: "llm-judge",
      rubric:
        "判断助手是否：(1) 表达了对客户不满的认可/共情，(2) 给出了具体的补救行动（加急/补偿/沟通），(3) 语气真诚不敷衍。三项都满足给 5 分；满足两项给 3-4 分；满足一项给 1-2 分；都没满足给 0 分。",
      scale: "0-5",
      passThreshold: 3,
    },
  },
].map((s) => evaluationSampleSchema.parse(s));

async function seedBuiltInEvaluations(): Promise<void> {
  const demoEval = await prisma.evaluation.upsert({
    where: { id: "eval_builtin_qg_demo_zh_customer" },
    update: {
      name: "中文客服 QA 示例",
      description: "覆盖 exact-match / contains / regex / llm-judge 四种判分器的演示评测集。",
      samples: builtInEvaluationSamples,
      totalSamples: builtInEvaluationSamples.length,
    },
    create: {
      id: "eval_builtin_qg_demo_zh_customer",
      userId: SEED_SYSTEM_USER_ID,
      name: "中文客服 QA 示例",
      description: "覆盖 exact-match / contains / regex / llm-judge 四种判分器的演示评测集。",
      samples: builtInEvaluationSamples,
      totalSamples: builtInEvaluationSamples.length,
    },
  });
  console.log(`Seeded evaluation: ${demoEval.id}`);
}

async function main(): Promise<void> {
  // Skip QG demo seed in test env: the seeded system user pre-occupies the
  // users table and breaks "first registered user → admin" auth e2e assertions.
  // QG e2e creates its own evaluation via API, so the demo seed isn't needed
  // for testing.
  if (process.env.NODE_ENV !== "test") {
    console.log("Seeding system user...");
    await seedSystemUser();
    console.log("  ✓ system seed user upserted");
  }

  console.log("Seeding evaluation_profiles...");
  await seedEvaluationProfiles();
  console.log(`  ✓ ${EVALUATION_PROFILES.length} built-in evaluation profiles upserted`);

  console.log("Seeding benchmark_templates...");
  await seedBenchmarkTemplates();
  console.log(`  ✓ ${BENCHMARK_TEMPLATES.length} official benchmark templates upserted`);

  // Skip QG demo seed in test env: the seeded system user pre-occupies the
  // users table and breaks "first registered user → admin" auth e2e assertions.
  // QG e2e creates its own evaluation via API, so the demo seed isn't needed
  // for testing.
  if (process.env.NODE_ENV !== "test") {
    console.log("Seeding built-in evaluations...");
    await seedBuiltInEvaluations();
    console.log("  ✓ built-in evaluation sets upserted");
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
