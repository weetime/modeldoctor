/*
  Warnings:

  - You are about to drop the column `evaluation_run_ids` on the `saved_compares` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "saved_compares" DROP COLUMN "evaluation_run_ids";
