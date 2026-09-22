-- CreateTable
CREATE TABLE "platform_sources" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'gpustack',
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "cluster_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMPTZ(3),
    "last_sync_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_models" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cluster_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "route_name" TEXT,
    "route_override" BOOLEAN NOT NULL DEFAULT false,
    "connection_id" TEXT,
    "current_revision_id" TEXT,
    "automation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "steps" TEXT[] DEFAULT ARRAY['diagnostics', 'quality_gate', 'benchmark']::TEXT[],
    "evaluation_id" TEXT,
    "gate_config" JSONB,
    "benchmark_template_id" TEXT,
    "schedule" TEXT NOT NULL DEFAULT 'off',
    "next_scheduled_at" TIMESTAMPTZ(3),
    "baseline_id" TEXT,
    "regression_thresholds" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discovered_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_revisions" (
    "id" TEXT NOT NULL,
    "discovered_model_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(3),

    CONSTRAINT "deployment_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "discovered_model_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "trigger_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "current_step" TEXT,
    "verdict" TEXT,
    "diagnostics_run_id" TEXT,
    "evaluation_run_id" TEXT,
    "benchmark_id" TEXT,
    "summary" JSONB,
    "locked_until" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_sources_user_id_idx" ON "platform_sources"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_models_connection_id_key" ON "discovered_models"("connection_id");

-- CreateIndex
CREATE INDEX "discovered_models_automation_enabled_schedule_next_schedule_idx" ON "discovered_models"("automation_enabled", "schedule", "next_scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_models_source_id_external_id_key" ON "discovered_models"("source_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_revisions_discovered_model_id_fingerprint_key" ON "deployment_revisions"("discovered_model_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_trigger_key_key" ON "automation_runs"("trigger_key");

-- CreateIndex
CREATE INDEX "automation_runs_discovered_model_id_created_at_idx" ON "automation_runs"("discovered_model_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_runs_source_id_status_created_at_idx" ON "automation_runs"("source_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "platform_sources" ADD CONSTRAINT "platform_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_models" ADD CONSTRAINT "discovered_models_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "platform_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_models" ADD CONSTRAINT "discovered_models_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_revisions" ADD CONSTRAINT "deployment_revisions_discovered_model_id_fkey" FOREIGN KEY ("discovered_model_id") REFERENCES "discovered_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_discovered_model_id_fkey" FOREIGN KEY ("discovered_model_id") REFERENCES "discovered_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "deployment_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
