import type { ConnectionKind } from "@modeldoctor/contracts";
import { safeFetch } from "./safe-fetch.js";

export interface VerifyKindInput {
  kind: ConnectionKind;
  baseUrl: string;
  apiKey?: string;
  /** Raw newline-separated `key: value` header lines, same format as
   * `ConnectionInput.customHeaders`. */
  customHeaders?: string;
}

export interface VerifyKindResult {
  kind: ConnectionKind;
  ok: boolean;
  version?: string;
  /** Free-form per-kind facts surfaced in the UI (e.g. number of upstream model
   * endpoints for a gateway, build commit for Prometheus). Always best-effort,
   * never required for `ok=true`. */
  details?: Record<string, unknown>;
  /** When `ok=false`, a short human-readable reason. */
  reason?: string;
}

/**
 * Probe a connection target to verify it is what the user said it is.
 *
 * Each kind has a known "health" path:
 *   model         — N/A here; use the full discover flow instead
 *   gateway       — Higress: /v1/models (gateway exposes a unified list)
 *   prometheus    — /api/v1/status/buildinfo
 *   alertmanager  — /api/v2/status
 *
 * Verification is deliberately shallow: we only confirm the endpoint
 * responds with the shape that distinguishes the target product. Deeper
 * checks (datasource reachable, receivers configured, etc.) belong in a
 * later "deep-verify" path.
 */
export async function verifyConnectionKind(input: VerifyKindInput): Promise<VerifyKindResult> {
  const { kind, baseUrl, apiKey, customHeaders } = input;
  const trimmed = baseUrl.replace(/\/$/, "");

  if (kind === "model") {
    return {
      kind,
      ok: false,
      reason: "verifyConnectionKind is for non-model kinds; use POST /api/connections/discover",
    };
  }

  const fetchOpts = {
    apiKey,
    extraHeaders: parseCustomHeaders(customHeaders),
    method: "GET" as const,
  };

  try {
    if (kind === "gateway") return await verifyGateway(trimmed, fetchOpts);
    if (kind === "prometheus") return await verifyPrometheus(trimmed, fetchOpts);
    if (kind === "alertmanager") return await verifyAlertmanager(trimmed, fetchOpts);
  } catch (err) {
    return {
      kind,
      ok: false,
      reason: (err as Error).message,
    };
  }

  return {
    kind,
    ok: false,
    reason: `unknown kind: ${kind}`,
  };
}

type FetchOpts = { apiKey?: string; extraHeaders?: Record<string, string>; method: "GET" };

// Mirrors parseCustomHeaders in discovery.service.ts; kept local so this
// module has no dependency on discovery internals. If a third copy is
// needed, extract to a shared file.
function parseCustomHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function verifyGateway(base: string, opts: FetchOpts): Promise<VerifyKindResult> {
  // Higress exposes the OpenAI-shape model list at /v1/models on the gateway
  // port. A 200 with a `{ data: [...] }` body is enough to confirm the
  // target speaks the LLM gateway protocol. We deliberately probe the
  // open route rather than /admin/* (which requires auth and is not always
  // exposed on the same port).
  const url = `${base}/v1/models`;
  const res = await safeFetch(url, opts);
  if (!res.ok) {
    return { kind: "gateway", ok: false, reason: `HTTP ${res.status} from ${url}` };
  }
  const body = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
  const modelCount = Array.isArray(body?.data) ? body.data.length : undefined;
  return {
    kind: "gateway",
    ok: true,
    details: modelCount !== undefined ? { modelCount } : undefined,
  };
}

async function verifyPrometheus(base: string, opts: FetchOpts): Promise<VerifyKindResult> {
  // GET /api/v1/status/buildinfo returns { status: "success", data: {
  //   version, revision, branch, buildUser, buildDate, goVersion } }.
  // Presence of `data.version` confirms this is a Prometheus instance, not
  // a generic HTTP endpoint.
  const url = `${base}/api/v1/status/buildinfo`;
  const res = await safeFetch(url, opts);
  if (!res.ok) {
    return { kind: "prometheus", ok: false, reason: `HTTP ${res.status} from ${url}` };
  }
  const body = (await res.json().catch(() => null)) as {
    status?: string;
    data?: { version?: string; revision?: string };
  } | null;
  if (body?.status !== "success" || !body?.data?.version) {
    return { kind: "prometheus", ok: false, reason: "buildinfo did not return a Prometheus shape" };
  }
  return {
    kind: "prometheus",
    ok: true,
    version: body.data.version,
    details: body.data.revision ? { revision: body.data.revision } : undefined,
  };
}

async function verifyAlertmanager(base: string, opts: FetchOpts): Promise<VerifyKindResult> {
  // GET /api/v2/status returns { cluster, versionInfo, config, uptime, ... }.
  // `versionInfo.version` is the distinguishing field; clusterPeers count
  // (when present) is a useful operational detail.
  const url = `${base}/api/v2/status`;
  const res = await safeFetch(url, opts);
  if (!res.ok) {
    return { kind: "alertmanager", ok: false, reason: `HTTP ${res.status} from ${url}` };
  }
  const body = (await res.json().catch(() => null)) as {
    versionInfo?: { version?: string };
    cluster?: { peers?: unknown[] };
  } | null;
  if (!body?.versionInfo?.version) {
    return {
      kind: "alertmanager",
      ok: false,
      reason: "status endpoint did not return an Alertmanager shape",
    };
  }
  // body is non-null here (narrowed by the versionInfo guard above), but stay
  // defensive on `cluster` since it's optional in the AM /api/v2/status shape.
  const peers = Array.isArray(body.cluster?.peers) ? body.cluster.peers.length : undefined;
  return {
    kind: "alertmanager",
    ok: true,
    version: body.versionInfo.version,
    details: peers !== undefined ? { clusterPeers: peers } : undefined,
  };
}
