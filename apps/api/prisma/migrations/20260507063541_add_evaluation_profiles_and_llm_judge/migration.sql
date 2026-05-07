-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "evaluation_profile_id" TEXT;

-- CreateTable
CREATE TABLE "evaluation_profiles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT,
    "description" TEXT,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "rules" JSONB NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_judge_providers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "llm_judge_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_profiles_slug_key" ON "evaluation_profiles"("slug");

-- CreateIndex
CREATE INDEX "evaluation_profiles_slug_idx" ON "evaluation_profiles"("slug");

-- CreateIndex
CREATE INDEX "evaluation_profiles_is_builtin_idx" ON "evaluation_profiles"("is_builtin");

-- CreateIndex
CREATE UNIQUE INDEX "llm_judge_providers_user_id_key" ON "llm_judge_providers"("user_id");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_evaluation_profile_id_fkey" FOREIGN KEY ("evaluation_profile_id") REFERENCES "evaluation_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_profiles" ADD CONSTRAINT "evaluation_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_judge_providers" ADD CONSTRAINT "llm_judge_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed 5 built-in evaluation profiles
INSERT INTO "evaluation_profiles" ("id", "slug", "name", "name_key", "description", "is_builtin", "rules", "source", "created_at", "updated_at") VALUES
('clxprofdefault0000000000', 'default', '通用 (chatbot 中庸假设)', 'profiles.default.name', '通用基线 — 适合大多数 LLM 服务的中庸阈值', true, '{"checks":{"inference.ttft.p95.ms":{"warn":500,"crit":1000,"weight":1.0},"inference.ttft.p99.ms":{"warn":800,"crit":2000,"weight":0.5},"inference.itl.p95.ms":{"warn":60,"crit":120,"weight":0.7},"inference.e2e.p95.ms":{"warn":3000,"crit":8000,"weight":0.7},"inference.e2e.p99.ms":{"warn":5000,"crit":15000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}}}', '基于 OpenAI Console / Anthropic Playground 公开 SLO + vLLM 官方 benchmark 中位数（vLLM v0.6.x release notes）综合得出的 chatbot 中庸默认。', NOW(), NOW()),
('clxprofchatbot0000000000', 'chatbot', 'Chatbot 实时对话', 'profiles.chatbot.name', '强调 TTFT — 适合实时聊天场景', true, '{"checks":{"inference.ttft.p95.ms":{"warn":300,"crit":800,"weight":1.5},"inference.ttft.p99.ms":{"warn":500,"crit":1500,"weight":0.7},"inference.itl.p95.ms":{"warn":50,"crit":100,"weight":0.7},"inference.e2e.p95.ms":{"warn":3000,"crit":8000,"weight":0.7},"inference.e2e.p99.ms":{"warn":5000,"crit":15000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}},"axisWeights":{"responsiveness":1.5}}', 'Chatbot 用户对首字延迟的主观感知阈值（<300ms 优秀, <800ms 可接受）。基于 OpenAI Playground 实测 + Anthropic Console SLO。', NOW(), NOW()),
('clxprofrag0000000000000', 'rag', 'RAG 检索增强', 'profiles.rag.name', '容忍 TTFT — 用户已习惯检索延迟', true, '{"checks":{"inference.ttft.p95.ms":{"warn":1500,"crit":3000,"weight":1.0},"inference.ttft.p99.ms":{"warn":2500,"crit":5000,"weight":0.5},"inference.itl.p95.ms":{"warn":60,"crit":120,"weight":0.7},"inference.e2e.p95.ms":{"warn":5000,"crit":12000,"weight":0.7},"inference.e2e.p99.ms":{"warn":8000,"crit":20000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}}}', 'RAG 场景：用户预期检索阶段延迟，TTFT 阈值放宽至 1500ms warn / 3000ms crit。LangSmith / Pinecone 公开 RAG benchmark 数据。', NOW(), NOW()),
('clxprofcodecomp00000000', 'code-completion', 'Code Completion', 'profiles.code-completion.name', '极致 TTFT — 必须比键入快', true, '{"checks":{"inference.ttft.p95.ms":{"warn":100,"crit":200,"weight":2.0},"inference.ttft.p99.ms":{"warn":150,"crit":350,"weight":1.0},"inference.itl.p95.ms":{"warn":30,"crit":60,"weight":1.0},"inference.e2e.p95.ms":{"warn":1000,"crit":3000,"weight":0.7},"inference.e2e.p99.ms":{"warn":2000,"crit":5000,"weight":0.5},"inference.error_rate":{"warn":0.01,"crit":0.05,"weight":1.0},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}},"axisWeights":{"responsiveness":2.0}}', 'Code completion：响应慢于打字节奏即不可用。Cursor / Copilot 公开数据：TTFT <100ms 优秀, <200ms 可接受。', NOW(), NOW()),
('clxproflongform00000000', 'long-form', 'Long-Form 长文生成', 'profiles.long-form.name', '强调吞吐 + 容错', true, '{"checks":{"inference.ttft.p95.ms":{"warn":1000,"crit":3000,"weight":0.7},"inference.ttft.p99.ms":{"warn":1500,"crit":5000,"weight":0.3},"inference.itl.p95.ms":{"warn":80,"crit":200,"weight":1.0},"inference.e2e.p95.ms":{"warn":15000,"crit":60000,"weight":0.5},"inference.e2e.p99.ms":{"warn":30000,"crit":120000,"weight":0.3},"inference.error_rate":{"warn":0.005,"crit":0.02,"weight":1.5},"inference.throughput.req_per_s":{"warn":10,"crit":5,"weight":0.5},"capacity.max_qps":{"warn":20,"crit":10,"weight":1.0},"capacity.error_rate":{"warn":0.05,"crit":0.10,"weight":1.0},"capacity.tail_ratio":{"warn":5.0,"crit":10.0,"weight":0.7},"gateway.error_rate":{"warn":0.005,"crit":0.02,"weight":1.0},"gateway.tail_ratio":{"warn":5.0,"crit":10.0,"weight":1.0},"gateway.throughput.req_per_s":{"warn":50,"crit":20,"weight":0.7}},"axisWeights":{"throughput":1.5}}', '长文场景：长输出对单次失败的容忍度低，error_rate 阈值更严；TTFT 容忍。', NOW(), NOW());
