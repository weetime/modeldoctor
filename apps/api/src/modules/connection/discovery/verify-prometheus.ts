import { safeFetch } from "./safe-fetch.js";

export type FetchOpts = { apiKey?: string; extraHeaders?: Record<string, string>; method: "GET" };

/**
 * Result shape for the Prometheus probe — returned by
 * `POST /api/prometheus-datasources/verify` (admin-only). Standalone from
 * `Connection` now that Prometheus is its own first-class entity
 * (`PrometheusDatasource`); the legacy `verifyConnectionKind` helper went
 * away with #220 along with the `Connection.kind` enum.
 */
export interface VerifyPrometheusResult {
  ok: boolean;
  version?: string;
  /** Free-form facts: currently `{ revision }` if the buildinfo includes one. */
  details?: Record<string, unknown>;
  /** When `ok=false`, a short human-readable reason. */
  reason?: string;
}

export async function verifyPrometheus(
  base: string,
  opts: FetchOpts,
): Promise<VerifyPrometheusResult> {
  // GET /api/v1/status/buildinfo returns { status: "success", data: {
  //   version, revision, branch, buildUser, buildDate, goVersion } }.
  // Presence of `data.version` confirms this is a Prometheus instance, not
  // a generic HTTP endpoint.
  const url = `${base}/api/v1/status/buildinfo`;
  const res = await safeFetch(url, opts);
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status} from ${url}` };
  }
  const body = (await res.json().catch(() => null)) as {
    status?: string;
    data?: { version?: string; revision?: string };
  } | null;
  if (body?.status !== "success" || !body?.data?.version) {
    return { ok: false, reason: "buildinfo did not return a Prometheus shape" };
  }
  return {
    ok: true,
    version: body.data.version,
    details: body.data.revision ? { revision: body.data.revision } : undefined,
  };
}
