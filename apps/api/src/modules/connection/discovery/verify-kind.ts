import type { ConnectionKind } from "@modeldoctor/contracts";
import { parseCustomHeaders } from "../../../common/http/parse-custom-headers.js";
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
 *   model    — N/A here; use the full discover flow instead
 *   gateway  — Higress: /v1/models (gateway exposes a unified list)
 *
 * (Prometheus moved to /api/prometheus-datasources/verify — see
 * verifyPrometheus below. Alertmanager is push-only via webhook and has no
 * outbound probe.)
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

export type FetchOpts = { apiKey?: string; extraHeaders?: Record<string, string>; method: "GET" };

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

/**
 * Result shape for the standalone Prometheus probe. Mirrors `VerifyKindResult`
 * but without a `kind` field — "prometheus" was dropped from `ConnectionKind`
 * once Prometheus instances became their own first-class entity
 * (`PrometheusDatasource`). The /api/prometheus-datasources/verify controller
 * calls this directly without going through `verifyConnectionKind`.
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

