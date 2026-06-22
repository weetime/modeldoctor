-- AlterTable: add the multi-provider columns. `name` is added nullable first so
-- the pre-existing singleton row survives; it is backfilled below, then promoted
-- to NOT NULL. `is_default` defaults to false for every row.
ALTER TABLE "llm_judge_providers" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT;

-- Backfill: the previous code maintained a singleton row (it only ever read the
-- most-recently-updated one). Promote that row to the named default so AI
-- features keep working unchanged across the singleton -> multi migration.
-- At most one row exists here, so the constant name 'default' cannot collide.
UPDATE "llm_judge_providers" SET "name" = 'default', "is_default" = true WHERE "name" IS NULL;

-- Now that every row has a name, enforce NOT NULL + uniqueness.
ALTER TABLE "llm_judge_providers" ALTER COLUMN "name" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "llm_judge_providers_name_key" ON "llm_judge_providers"("name");
