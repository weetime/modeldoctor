-- Pre-cleanup: NULL out any orphan template_id references to make the
-- subsequent ALTER TABLE ADD FK safe in case dev/staging/prod DBs have
-- baseline rows pointing to deleted benchmark_templates rows.
-- Mirrors the FK's ON DELETE SET NULL semantics.
UPDATE "baselines"
SET "template_id" = NULL
WHERE "template_id" IS NOT NULL
  AND "template_id" NOT IN (SELECT "id" FROM "benchmark_templates");

-- (Original Prisma-generated DDL follows)

-- CreateIndex
CREATE INDEX "baselines_template_id_idx" ON "baselines"("template_id");

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "benchmark_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
