-- Seed 10 official inference benchmark templates (v1)
--
-- Provenance / parameter sourcing: docs/superpowers/specs/2026-05-12-official-benchmark-templates-design.md
-- Stable IDs (tpl_official_*) so re-running this migration is a no-op via ON CONFLICT DO NOTHING.
-- v1 is zh-CN-only; en-US i18n is tracked as v2 follow-up (needs `name_key` column on benchmark_templates).
--
-- Followed the evaluation_profiles precedent (20260507063541) of seeding builtin/official rows via INSERT
-- inside a migration. Each config payload is checked against the matching adapter zod schema in
-- packages/tool-adapters (guidellm | genai-perf) before being put here; inference scenario constraint
-- (rateType ∈ {constant, poisson, throughput, synchronous}, no sweep) is respected.

INSERT INTO "benchmark_templates" (
  "id", "name", "description", "scenario", "tool", "config",
  "is_official", "created_by", "tags", "created_at", "updated_at"
)
VALUES
  (
    'tpl_official_chat_standard',
    '通用对话 · 标准',
    '通用对话基线，对齐 GuideLLM 上游 chat.json（input 512 / output 256）。10 RPS 泊松、1000 次请求，先看 TTFT/TPOT p95 水位。',
    'inference',
    'guidellm',
    '{"profile":"throughput","apiType":"chat","datasetName":"random","datasetInputTokens":512,"datasetOutputTokens":256,"rateType":"poisson","requestRate":10,"totalRequests":1000,"maxDurationSeconds":300,"maxConcurrency":100,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['chat','baseline','guidellm-upstream'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_rag_standard',
    'RAG · 检索增强',
    '检索增强对话形状，对齐 GuideLLM 上游 rag.json（input 4096 / output 512）。5 RPS 泊松、500 次请求，长输入压 TTFT/prefill。',
    'inference',
    'guidellm',
    '{"profile":"long_context","apiType":"chat","datasetName":"random","datasetInputTokens":4096,"datasetOutputTokens":512,"rateType":"poisson","requestRate":5,"totalRequests":500,"maxDurationSeconds":600,"maxConcurrency":64,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['rag','long-input','guidellm-upstream'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_vllm_default_baseline',
    'vLLM 兼容基线（约定值）',
    '对齐 vLLM RandomDataset 代码常量 input=1024 / output=128。注意这是约定值不是真实分布——仅用于跨工具横评对账。',
    'inference',
    'guidellm',
    '{"profile":"custom","apiType":"chat","datasetName":"random","datasetInputTokens":1024,"datasetOutputTokens":128,"rateType":"throughput","requestRate":0,"totalRequests":1000,"maxDurationSeconds":600,"maxConcurrency":64,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['baseline','vllm-default','synthetic'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_production_chat_azure_2024',
    '生产对话流量（Azure 2024）',
    '锚定 Azure LLM Inference Trace 2024 conv（p50 input 967 / p50 output 41）。input 1000 / output 100，30 RPS 泊松对齐单实例量级。',
    'inference',
    'guidellm',
    '{"profile":"custom","apiType":"chat","datasetName":"random","datasetInputTokens":1000,"datasetOutputTokens":100,"rateType":"poisson","requestRate":30,"totalRequests":3000,"maxDurationSeconds":600,"maxConcurrency":200,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['chat','production-trace','azure-2024'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_copilot_code_completion_azure_2024',
    'Copilot 代码补全（Azure 2024）',
    '锚定 Azure 2024 code 服务（p50 input 1976 / p50 output 9）。极短输出、几乎纯 prefill，重点看 TTFT p99（补全要早于下一键）。',
    'inference',
    'guidellm',
    '{"profile":"custom","apiType":"chat","datasetName":"random","datasetInputTokens":2000,"datasetOutputTokens":20,"rateType":"poisson","requestRate":30,"totalRequests":3000,"maxDurationSeconds":600,"maxConcurrency":200,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['code-completion','production-trace','azure-2024','prefill-dominated'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_long_doc_summarization',
    '长文档摘要',
    '长文档摘要：input 8000 / output 500，synchronous 顺序发送 200 次。主测 TTFT + KV 内存余量——长上下文常 OOM 而不是慢。',
    'inference',
    'guidellm',
    '{"profile":"long_context","apiType":"chat","datasetName":"random","datasetInputTokens":8000,"datasetOutputTokens":500,"rateType":"synchronous","requestRate":0,"totalRequests":200,"maxDurationSeconds":1800,"maxConcurrency":1,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['summarization','long-context','memory-bound'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_long_context_chat_mooncake',
    '长上下文对话（Mooncake）',
    '锚定 Mooncake FAST''25 conv trace（p50 6909 / 350，40% prefix-cache 命中）。input 6000 / output 350。注意：我们 stateless 重放测不到 KV 复用收益，TTFT 是悲观上界。',
    'inference',
    'guidellm',
    '{"profile":"long_context","apiType":"chat","datasetName":"random","datasetInputTokens":6000,"datasetOutputTokens":350,"rateType":"poisson","requestRate":5,"totalRequests":500,"maxDurationSeconds":1200,"maxConcurrency":32,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['chat','long-context','production-trace','mooncake'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_reasoning_output_heavy',
    '推理 · 输出密集（CoT）',
    '推理/长 CoT 形态：input 300 / output 1500（全集唯一 output > input）。覆盖 o1、R1 类推理模型，主测 TPOT 与输出 tok/s（decode-bound）。',
    'inference',
    'guidellm',
    '{"profile":"generation_heavy","apiType":"chat","datasetName":"random","datasetInputTokens":300,"datasetOutputTokens":1500,"rateType":"poisson","requestRate":5,"totalRequests":500,"maxDurationSeconds":900,"maxConcurrency":32,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['reasoning','cot','decode-bound','generation-heavy'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_agent_tool_use_mooncake',
    'Agent · Tool 调用（Mooncake）',
    '锚定 Mooncake tool&agent trace（p50 6346 / 30，p95 600——bimodal）。input 6000 / output 50，长 system prompt + 短 JSON 输出。',
    'inference',
    'guidellm',
    '{"profile":"long_context","apiType":"chat","datasetName":"random","datasetInputTokens":6000,"datasetOutputTokens":50,"rateType":"poisson","requestRate":10,"totalRequests":1000,"maxDurationSeconds":900,"maxConcurrency":64,"validateBackend":false}'::jsonb,
    true,
    NULL,
    ARRAY['agent','tool-use','production-trace','mooncake','long-input'],
    NOW(),
    NOW()
  ),
  (
    'tpl_official_embeddings_high_throughput',
    '嵌入服务高吞吐',
    '嵌入服务压测：endpoint=embeddings，input 256 tokens，并发 64、2000 次请求。无生成、非流式，主测 RPS 与 p99 latency。',
    'inference',
    'genai-perf',
    '{"endpointType":"embeddings","numPrompts":2000,"concurrency":64,"inputTokensMean":256,"inputTokensStddev":0,"streaming":false}'::jsonb,
    true,
    NULL,
    ARRAY['embeddings','non-generative','high-throughput'],
    NOW(),
    NOW()
  )
ON CONFLICT ("id") DO NOTHING;
