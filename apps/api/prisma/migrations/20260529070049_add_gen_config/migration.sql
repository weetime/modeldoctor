-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN     "gen_config" JSONB;

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "gen_config" JSONB;
