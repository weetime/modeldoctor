/** Flatten an arbitrary summaryMetrics object to numeric leaves keyed by dot
 * path. Non-numeric / non-finite leaves are dropped. Arrays are skipped (not
 * recursed) — index-keyed paths like `latencies.0` carry no comparable
 * semantics and only add alignment noise. */
export function flattenNumeric(obj: unknown, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) out[path] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenNumeric(v, path));
    }
  }
  return out;
}

export interface AlignedComparison {
  benchmarks: Array<{ id: string; name: string }>;
  rows: Array<{ metric: string; values: Array<number | null> }>;
}

/** Tool-agnostic alignment: union of all numeric metric paths, one row per
 * metric with a value (or null) per benchmark, in input order. Direction of
 * "better" is intentionally NOT inferred — the caller (agent) judges it. */
export function alignBenchmarkMetrics(
  items: Array<{ id: string; name: string; summaryMetrics: unknown }>,
): AlignedComparison {
  const flats = items.map((i) => ({ id: i.id, name: i.name, m: flattenNumeric(i.summaryMetrics) }));
  const keys = Array.from(new Set(flats.flatMap((f) => Object.keys(f.m)))).sort();
  return {
    benchmarks: flats.map((f) => ({ id: f.id, name: f.name })),
    rows: keys.map((metric) => ({ metric, values: flats.map((f) => f.m[metric] ?? null) })),
  };
}
