-- DropForeignKey
ALTER TABLE "baselines" DROP CONSTRAINT "baselines_run_id_fkey";

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
