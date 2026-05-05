-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
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
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "custom_headers" TEXT NOT NULL DEFAULT '',
    "query_params" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prometheus_url" TEXT,
    "server_kind" TEXT,
    "tokenizer_hf_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

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
    "driver_kind" TEXT NOT NULL,
    "name" TEXT,
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

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
