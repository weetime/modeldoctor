-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvaluationGateResult" AS ENUM ('PASSED', 'WARNING', 'FAILED');

-- CreateEnum
CREATE TYPE "SampleDelta" AS ENUM ('REGRESSION', 'IMPROVEMENT', 'BOTH_PASS', 'BOTH_FAIL', 'NA');

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "samples" JSONB NOT NULL,
    "total_samples" INTEGER NOT NULL DEFAULT 0,
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
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

-- CreateIndex
CREATE INDEX "evaluations_user_id_created_at_idx" ON "evaluations"("user_id", "created_at");

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

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
