-- Drop saved_compares that reference benchmarks using deprecated tools.
DELETE FROM saved_compares
WHERE EXISTS (
  SELECT 1 FROM benchmarks b
  WHERE b.id = ANY(saved_compares.benchmark_ids)
    AND b.tool IN ('genai-perf', 'kv-cache-stress')
);

-- Drop benchmark rows using deprecated tools.
DELETE FROM benchmarks WHERE tool IN ('genai-perf', 'kv-cache-stress');

-- Drop template rows using deprecated tools.
DELETE FROM benchmark_templates WHERE tool IN ('genai-perf', 'kv-cache-stress');
