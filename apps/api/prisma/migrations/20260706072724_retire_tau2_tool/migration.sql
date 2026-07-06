-- Tool-retirement carve-out (see CLAUDE.md): `benchmarkToolSchema` dropped
-- the "tau2" enum member (renamed to "tau3" for the τ³-bench v1.0.0 rename).
-- Pre-existing rows tagged tool='tau2' would fail zod validation on every
-- subsequent list/detail/metric read, so they are removed here. `tool` is a
-- plain String column (no schema change) — this is data cleanup only.
DELETE FROM benchmarks WHERE tool = 'tau2';
DELETE FROM benchmark_templates WHERE tool = 'tau2';
DELETE FROM saved_compares WHERE tool = 'tau2';
