// apps/web/src/features/insights/matrix-filter.ts
import type { InsightsMatrixResponse } from "@modeldoctor/contracts";

export interface FilterMatrixDataOptions {
  q: string;
  /** Category to match against `endpoint.category`, or `null` for no filter. */
  category: string | null;
}

/**
 * Pure, testable filter for the Test Insights matrix response.
 *
 * Filters `endpoints` by the same predicate InsightsMatrixPage applies for
 * the grid (case-insensitive `q` match against `model`+`name`, optional
 * `category` match), then derives `cells` and `dimensions` from the SAME
 * surviving endpoint set so Grid, ScatterPanel, and ForceMap all consume one
 * consistent view — no leftover unfiltered cells/dimensions pointing at
 * filtered-out endpoints.
 */
export function filterMatrixData(
  data: InsightsMatrixResponse,
  opts: FilterMatrixDataOptions,
): InsightsMatrixResponse {
  const needle = opts.q.trim().toLowerCase();
  const category = opts.category;

  const endpoints = data.endpoints.filter((endpoint) => {
    if (category != null && endpoint.category !== category) return false;
    if (needle) {
      const haystack = `${endpoint.model} ${endpoint.name}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const endpointIds = new Set(endpoints.map((e) => e.id));
  const cells = data.cells.filter((cell) => endpointIds.has(cell.endpointId));

  // Distinct surviving endpoints per dimKey — a dim is kept only if at least
  // one surviving cell references it; `count` reflects the filtered set, not
  // the original.
  const endpointsByDim = new Map<string, Set<string>>();
  for (const cell of cells) {
    let set = endpointsByDim.get(cell.dimKey);
    if (!set) {
      set = new Set();
      endpointsByDim.set(cell.dimKey, set);
    }
    set.add(cell.endpointId);
  }

  const dimensions = data.dimensions
    .filter((dim) => (endpointsByDim.get(dim.key)?.size ?? 0) > 0)
    .map((dim) => ({
      ...dim,
      count: endpointsByDim.get(dim.key)?.size ?? 0,
    }));

  return {
    aggregate: data.aggregate,
    range: data.range,
    generatedAt: data.generatedAt,
    dimensions,
    endpoints,
    cells,
  };
}
