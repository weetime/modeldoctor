-- Drop existing rows so the new NOT NULL column can be added without backfill.
DELETE FROM "refresh_tokens";

ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT NOT NULL;
ALTER TABLE "refresh_tokens" ADD COLUMN "parent_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_id" TEXT;

CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "refresh_tokens_parent_id_idx" ON "refresh_tokens"("parent_id");
