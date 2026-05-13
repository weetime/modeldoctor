-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN     "baseline_run_id_at_execution" TEXT;

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "baseline_run_id" TEXT;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_baseline_run_id_fkey" FOREIGN KEY ("baseline_run_id") REFERENCES "evaluation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
