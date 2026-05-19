-- CreateTable
CREATE TABLE "prometheus_datasources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "bearer_cipher" TEXT NOT NULL DEFAULT '',
    "custom_headers" TEXT NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prometheus_datasources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prometheus_datasources_name_key" ON "prometheus_datasources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "prometheus_datasources_base_url_key" ON "prometheus_datasources"("base_url");

-- AlterTable: add the new FK column first so the data-migration step below
-- can write into it before we drop the legacy prometheus_url column.
ALTER TABLE "connections" ADD COLUMN "prometheus_datasource_id" TEXT;

-- 1. Migrate existing kind='prometheus' Connection rows into prometheus_datasources.
--    Dedupe by base_url; keep the earliest row's id / name / customHeaders;
--    bearerCipher is empty (legacy rows didn't carry one).
INSERT INTO "prometheus_datasources" (
  id, name, base_url, bearer_cipher, custom_headers, is_default, created_at, updated_at
)
SELECT DISTINCT ON (base_url)
  id,
  name,
  base_url,
  '' AS bearer_cipher,
  custom_headers,
  FALSE AS is_default,
  created_at,
  updated_at
FROM "connections"
WHERE kind = 'prometheus'
ORDER BY base_url, created_at ASC;

-- 2. Mark the earliest-created row as the global default.
UPDATE "prometheus_datasources"
   SET is_default = TRUE
 WHERE id = (
   SELECT id FROM "prometheus_datasources" ORDER BY created_at ASC LIMIT 1
 );

-- 3. Backfill connection.prometheus_datasource_id from the dead prometheus_url field.
--    Match by base_url (the new table's base_url is unique).
UPDATE "connections" AS c
   SET prometheus_datasource_id = ds.id
  FROM "prometheus_datasources" AS ds
 WHERE c.prometheus_url IS NOT NULL
   AND c.prometheus_url = ds.base_url;

-- 4. Drop migrated kind='prometheus' Connection rows. This is data-DML in a
--    migration — allowed under CLAUDE.md's enum-narrowing carve-out: Task 1
--    narrowed connectionKindSchema to ['model','gateway','alertmanager'], so
--    any remaining kind='prometheus' rows would fail zod parse on every
--    list/detail read. Deletion here is the required data fixup that the
--    schema change forces.
DELETE FROM "connections" WHERE kind = 'prometheus';

-- AlterTable: drop the legacy column now that data has been migrated.
ALTER TABLE "connections" DROP COLUMN "prometheus_url";

-- CreateIndex
CREATE INDEX "connections_prometheus_datasource_id_idx" ON "connections"("prometheus_datasource_id");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_prometheus_datasource_id_fkey" FOREIGN KEY ("prometheus_datasource_id") REFERENCES "prometheus_datasources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Partial unique index — global; only one row may carry is_default=true.
CREATE UNIQUE INDEX "uniq_default_prom_ds"
  ON "prometheus_datasources"(("is_default"))
  WHERE "is_default" = TRUE;
