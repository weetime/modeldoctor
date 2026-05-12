/*
  Warnings:

  - Added the required column `updated_at` to the `evaluation_runs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
