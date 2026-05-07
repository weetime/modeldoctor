import type { EndpointReportRange } from "@modeldoctor/contracts";

/**
 * Narrow an arbitrary `?range=` query value to the closed enum the
 * insights pages accept, falling back to "30d". Without this, a typo'd
 * shared link previously passed straight to date math and crashed with
 * "Invalid time value" (see InsightsDetailPage hardening).
 */
export function getValidatedRange(raw: string | null | undefined): EndpointReportRange {
  return raw === "7d" || raw === "30d" || raw === "90d" ? raw : "30d";
}
