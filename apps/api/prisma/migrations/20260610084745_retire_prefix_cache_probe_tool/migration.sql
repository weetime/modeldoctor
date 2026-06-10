-- Tool retirement: `prefix-cache-probe` was removed from benchmarkToolSchema
-- (the scenario `prefix-cache-validation` now runs on standard aiperf). Rows
-- still tagged with the dropped tool fail zod parsing on every list/detail/
-- metric read, so they must be deleted. This is the sanctioned data-DML
-- carve-out for enum-narrowing fallout (see apps CLAUDE.md), not a business
-- data write.

-- Remove saved compares that reference a prefix-cache-probe benchmark first,
-- so no saved_compares.benchmark_ids is left pointing at a deleted row.
DELETE FROM "saved_compares"
WHERE "benchmark_ids" && ARRAY(
  SELECT "id" FROM "benchmarks" WHERE "tool" = 'prefix-cache-probe'
)::text[];

-- Remove the probe benchmarks and the retired probe templates
-- (tpl_pc_quick_sanity / tpl_pc_deeper_coverage carried tool=prefix-cache-probe).
DELETE FROM "benchmarks" WHERE "tool" = 'prefix-cache-probe';
DELETE FROM "benchmark_templates" WHERE "tool" = 'prefix-cache-probe';
