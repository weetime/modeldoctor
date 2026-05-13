-- AlterTable
ALTER TABLE "evaluation_runs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "saved_compares" ADD COLUMN     "evaluation_run_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
