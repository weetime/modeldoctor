/*
  Warnings:

  - You are about to drop the column `baseline_run_id` on the `evaluations` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "evaluations" DROP CONSTRAINT "evaluations_baseline_run_id_fkey";

-- DropIndex
DROP INDEX "evaluations_baseline_run_id_idx";

-- AlterTable
ALTER TABLE "evaluations" DROP COLUMN "baseline_run_id";
