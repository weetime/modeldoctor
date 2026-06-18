-- Scenario id rename (enum-change data fixup; CLAUDE.md carve-out).
-- prefix-cache-validation -> lb-strategy, kv-cache-stress -> engine-kv-cache.
-- Only benchmarks / benchmark_templates / alert_events have a `scenario` column.
UPDATE "benchmarks"          SET "scenario" = 'lb-strategy'     WHERE "scenario" = 'prefix-cache-validation';
UPDATE "benchmark_templates" SET "scenario" = 'lb-strategy'     WHERE "scenario" = 'prefix-cache-validation';
UPDATE "alert_events"        SET "scenario" = 'lb-strategy'     WHERE "scenario" = 'prefix-cache-validation';
UPDATE "benchmarks"          SET "scenario" = 'engine-kv-cache' WHERE "scenario" = 'kv-cache-stress';
UPDATE "benchmark_templates" SET "scenario" = 'engine-kv-cache' WHERE "scenario" = 'kv-cache-stress';
UPDATE "alert_events"        SET "scenario" = 'engine-kv-cache' WHERE "scenario" = 'kv-cache-stress';
