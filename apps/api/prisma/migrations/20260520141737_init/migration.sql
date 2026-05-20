-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('slack', 'webhook', 'feishu', 'dingtalk');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvaluationGateResult" AS ENUM ('PASSED', 'WARNING', 'FAILED');

-- CreateEnum
CREATE TYPE "SampleDelta" AS ENUM ('REGRESSION', 'IMPROVEMENT', 'BOTH_PASS', 'BOTH_FAIL', 'NA');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "replaced_by_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'model',
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "custom_headers" TEXT NOT NULL DEFAULT '',
    "query_params" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "server_kind" TEXT,
    "tokenizer_hf_id" TEXT,
    "prometheus_datasource_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "evaluation_profile_id" TEXT,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmarks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "connection_id" TEXT,
    "scenario" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "tool_version" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "status_message" TEXT,
    "progress" DOUBLE PRECISION,
    "driver_handle" TEXT,
    "params" JSONB NOT NULL,
    "raw_output" JSONB,
    "summary_metrics" JSONB,
    "server_metrics" JSONB,
    "template_id" TEXT,
    "parent_benchmark_id" TEXT,
    "baseline_id" TEXT,
    "logs" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scenario" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" TEXT[] DEFAULT ARRAY['chat']::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "benchmark_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostics_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "connection_id" TEXT,
    "status" TEXT NOT NULL,
    "status_message" TEXT,
    "probes" TEXT[],
    "path_override" JSONB NOT NULL DEFAULT '{}',
    "results" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnostics_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "benchmark_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "template_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

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
    "base_url" TEXT NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "llm_judge_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_subscriptions" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "filter" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_compares" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "benchmark_ids" TEXT[],
    "evaluation_run_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage_labels" JSONB NOT NULL,
    "baseline_id" TEXT,
    "context" TEXT,
    "narrative" JSONB,
    "narrative_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_compares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "samples" JSONB NOT NULL,
    "total_samples" INTEGER NOT NULL DEFAULT 0,
    "baseline_run_id" TEXT,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "evaluation_version" INTEGER NOT NULL,
    "evaluation_snapshot" JSONB NOT NULL,
    "endpoint_a_id" TEXT NOT NULL,
    "endpoint_b_id" TEXT,
    "gate_config" JSONB NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "gate_result" "EvaluationGateResult",
    "aggregate_metrics" JSONB,
    "processed_samples" INTEGER NOT NULL DEFAULT 0,
    "total_samples" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "baseline_run_id_at_execution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_run_samples" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sample_id" TEXT NOT NULL,
    "sample_idx" INTEGER NOT NULL,
    "result_a" JSONB NOT NULL,
    "result_b" JSONB,
    "delta" "SampleDelta" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_run_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "scenario" TEXT,
    "alert_name" TEXT NOT NULL,
    "connection_id" TEXT,
    "model_name" TEXT,
    "engine" TEXT,
    "instance" TEXT,
    "labels" JSONB NOT NULL,
    "annotations" JSONB NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_subscribers" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "min_severity" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connection_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_explanations" (
    "id" TEXT NOT NULL,
    "alert_event_id" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "recommendations" JSONB NOT NULL,
    "ai_severity" TEXT NOT NULL,
    "llm_provider" TEXT NOT NULL,
    "llm_model" TEXT NOT NULL,
    "tokens_used" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prometheus_datasources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "bearer_cipher" TEXT NOT NULL DEFAULT '',
    "custom_headers" TEXT NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prometheus_datasources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_parent_id_idx" ON "refresh_tokens"("parent_id");

-- CreateIndex
CREATE INDEX "connections_user_id_idx" ON "connections"("user_id");

-- CreateIndex
CREATE INDEX "connections_prometheus_datasource_id_idx" ON "connections"("prometheus_datasource_id");

-- CreateIndex
CREATE UNIQUE INDEX "connections_user_id_name_key" ON "connections"("user_id", "name");

-- CreateIndex
CREATE INDEX "benchmarks_user_id_created_at_idx" ON "benchmarks"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "benchmarks_scenario_status_idx" ON "benchmarks"("scenario", "status");

-- CreateIndex
CREATE INDEX "benchmarks_tool_created_at_idx" ON "benchmarks"("tool", "created_at");

-- CreateIndex
CREATE INDEX "benchmarks_connection_id_idx" ON "benchmarks"("connection_id");

-- CreateIndex
CREATE INDEX "benchmarks_parent_benchmark_id_idx" ON "benchmarks"("parent_benchmark_id");

-- CreateIndex
CREATE INDEX "benchmarks_baseline_id_idx" ON "benchmarks"("baseline_id");

-- CreateIndex
CREATE INDEX "benchmarks_template_id_idx" ON "benchmarks"("template_id");

-- CreateIndex
CREATE INDEX "benchmark_templates_scenario_idx" ON "benchmark_templates"("scenario");

-- CreateIndex
CREATE INDEX "benchmark_templates_tool_idx" ON "benchmark_templates"("tool");

-- CreateIndex
CREATE INDEX "benchmark_templates_is_official_idx" ON "benchmark_templates"("is_official");

-- CreateIndex
CREATE INDEX "benchmark_templates_created_by_idx" ON "benchmark_templates"("created_by");

-- CreateIndex
CREATE INDEX "diagnostics_runs_user_id_created_at_idx" ON "diagnostics_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "diagnostics_runs_connection_id_idx" ON "diagnostics_runs"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "baselines_benchmark_id_key" ON "baselines"("benchmark_id");

-- CreateIndex
CREATE INDEX "baselines_user_id_idx" ON "baselines"("user_id");

-- CreateIndex
CREATE INDEX "baselines_template_id_idx" ON "baselines"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_profiles_slug_key" ON "evaluation_profiles"("slug");

-- CreateIndex
CREATE INDEX "evaluation_profiles_is_builtin_idx" ON "evaluation_profiles"("is_builtin");

-- CreateIndex
CREATE INDEX "notification_channels_user_id_idx" ON "notification_channels"("user_id");

-- CreateIndex
CREATE INDEX "notification_subscriptions_channel_id_event_type_idx" ON "notification_subscriptions"("channel_id", "event_type");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_retry_at_idx" ON "notification_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "saved_compares_user_id_created_at_idx" ON "saved_compares"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "evaluations_user_id_created_at_idx" ON "evaluations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "evaluations_baseline_run_id_idx" ON "evaluations"("baseline_run_id");

-- CreateIndex
CREATE INDEX "evaluations_is_official_idx" ON "evaluations"("is_official");

-- CreateIndex
CREATE INDEX "evaluation_runs_user_id_created_at_idx" ON "evaluation_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "evaluation_runs_evaluation_id_idx" ON "evaluation_runs"("evaluation_id");

-- CreateIndex
CREATE INDEX "evaluation_runs_status_idx" ON "evaluation_runs"("status");

-- CreateIndex
CREATE INDEX "evaluation_run_samples_run_id_idx" ON "evaluation_run_samples"("run_id");

-- CreateIndex
CREATE INDEX "evaluation_run_samples_run_id_delta_idx" ON "evaluation_run_samples"("run_id", "delta");

-- CreateIndex
CREATE INDEX "alert_events_connection_id_received_at_idx" ON "alert_events"("connection_id", "received_at");

-- CreateIndex
CREATE INDEX "alert_events_status_severity_received_at_idx" ON "alert_events"("status", "severity", "received_at");

-- CreateIndex
CREATE INDEX "alert_events_scenario_idx" ON "alert_events"("scenario");

-- CreateIndex
CREATE UNIQUE INDEX "alert_events_fingerprint_starts_at_key" ON "alert_events"("fingerprint", "starts_at");

-- CreateIndex
CREATE INDEX "connection_subscribers_connection_id_idx" ON "connection_subscribers"("connection_id");

-- CreateIndex
CREATE INDEX "connection_subscribers_user_id_idx" ON "connection_subscribers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "connection_subscribers_connection_id_user_id_channel_id_key" ON "connection_subscribers"("connection_id", "user_id", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_explanations_alert_event_id_key" ON "alert_explanations"("alert_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "prometheus_datasources_name_key" ON "prometheus_datasources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "prometheus_datasources_base_url_key" ON "prometheus_datasources"("base_url");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_prometheus_datasource_id_fkey" FOREIGN KEY ("prometheus_datasource_id") REFERENCES "prometheus_datasources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_evaluation_profile_id_fkey" FOREIGN KEY ("evaluation_profile_id") REFERENCES "evaluation_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "benchmark_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_parent_benchmark_id_fkey" FOREIGN KEY ("parent_benchmark_id") REFERENCES "benchmarks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_templates" ADD CONSTRAINT "benchmark_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostics_runs" ADD CONSTRAINT "diagnostics_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostics_runs" ADD CONSTRAINT "diagnostics_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_benchmark_id_fkey" FOREIGN KEY ("benchmark_id") REFERENCES "benchmarks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "benchmark_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_profiles" ADD CONSTRAINT "evaluation_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_compares" ADD CONSTRAINT "saved_compares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_baseline_run_id_fkey" FOREIGN KEY ("baseline_run_id") REFERENCES "evaluation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_endpoint_a_id_fkey" FOREIGN KEY ("endpoint_a_id") REFERENCES "connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_endpoint_b_id_fkey" FOREIGN KEY ("endpoint_b_id") REFERENCES "connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_run_samples" ADD CONSTRAINT "evaluation_run_samples_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_subscribers" ADD CONSTRAINT "connection_subscribers_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_subscribers" ADD CONSTRAINT "connection_subscribers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_subscribers" ADD CONSTRAINT "connection_subscribers_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_explanations" ADD CONSTRAINT "alert_explanations_alert_event_id_fkey" FOREIGN KEY ("alert_event_id") REFERENCES "alert_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
