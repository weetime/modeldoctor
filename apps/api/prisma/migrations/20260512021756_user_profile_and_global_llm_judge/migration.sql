/*
  Warnings:

  - You are about to drop the column `user_id` on the `llm_judge_providers` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "llm_judge_providers" DROP CONSTRAINT "llm_judge_providers_user_id_fkey";

-- DropIndex
DROP INDEX "llm_judge_providers_user_id_key";

-- AlterTable
ALTER TABLE "llm_judge_providers" DROP COLUMN "user_id";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "display_name" TEXT;
