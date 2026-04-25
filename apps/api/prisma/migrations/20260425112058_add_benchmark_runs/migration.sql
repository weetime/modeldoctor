-- CreateTable
CREATE TABLE "benchmark_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "profile" TEXT NOT NULL DEFAULT 'custom',
    "api_type" TEXT NOT NULL,
    "api_url" TEXT NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dataset_name" TEXT NOT NULL DEFAULT 'random',
    "dataset_input_tokens" INTEGER,
    "dataset_output_tokens" INTEGER,
    "dataset_seed" INTEGER,
    "request_rate" INTEGER NOT NULL DEFAULT 0,
    "total_requests" INTEGER NOT NULL DEFAULT 1000,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "state_message" TEXT,
    "progress" DOUBLE PRECISION,
    "job_name" TEXT,
    "metrics_summary" JSONB,
    "raw_metrics" JSONB,
    "logs" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "benchmark_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "benchmark_runs_user_id_created_at_idx" ON "benchmark_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "benchmark_runs_state_idx" ON "benchmark_runs"("state");

-- AddForeignKey
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
