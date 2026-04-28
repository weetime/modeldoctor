import { useAuthStore } from "@/stores/auth-store";
import type { PublicUser } from "@modeldoctor/contracts";
import { StandardErrorResponseSchema } from "@modeldoctor/contracts";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Discriminated outcome of a /api/auth/refresh attempt. Distinguishes a
 * genuine auth failure (401/403 — clear store, redirect to /login) from
 * a transient blip (429/5xx/network — retry with backoff, do NOT clear
 * the store). Used by BootGate, the proactive scheduler, and the 401
 * recovery path inside request().
 */
export type RefreshResult =
  | { kind: "ok"; accessToken: string }
  | { kind: "unauthenticated" }
  | { kind: "transient"; status: number; retryAfterMs: number };

// Single-tab in-flight dedup. Cross-tab dedup arrives in B5 via Web Locks.
let refreshInFlight: Promise<RefreshResult> | null = null;

export async function refreshAccessToken(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  const p: Promise<RefreshResult> = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const body = (await res.json()) as {
          accessToken: string;
          accessTokenExpiresAt: string;
          user: PublicUser;
        };
        useAuthStore.getState().setAuth(body.accessToken, body.user, body.accessTokenExpiresAt);
        return { kind: "ok", accessToken: body.accessToken };
      }
      if (res.status === 401 || res.status === 403) {
        return { kind: "unauthenticated" };
      }
      // 429 / 5xx — transient. Honor Retry-After if present (seconds).
      const ra = res.headers.get("Retry-After");
      const retryAfterMs = ra ? Math.max(0, Number.parseInt(ra, 10) * 1000) : 0;
      return { kind: "transient", status: res.status, retryAfterMs };
    } catch {
      // Network error.
      return { kind: "transient", status: 0, retryAfterMs: 0 };
    }
  })();
  refreshInFlight = p;
  void p.finally(() => {
    if (refreshInFlight === p) refreshInFlight = null;
  });
  return p;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = async (token: string | null): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers, credentials: "include" });
  };

  let res = await doFetch(useAuthStore.getState().accessToken);

  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const result = await refreshAccessToken();
    if (result.kind === "ok") {
      res = await doFetch(result.accessToken);
    } else if (result.kind === "unauthenticated") {
      useAuthStore.getState().clear();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      throw new ApiError(401, "Unauthorized");
    } else {
      // transient — surface the original 401 since we couldn't recover here.
      // Don't clear the store; the proactive scheduler (B8) or a later
      // request will retry on its own.
      throw new ApiError(401, "Unauthorized (refresh transient)");
    }
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, text || `HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    const parsed = StandardErrorResponseSchema.safeParse(data);
    if (parsed.success) {
      throw new ApiError(
        res.status,
        parsed.data.error.message,
        parsed.data.error.code,
        parsed.data.error.requestId,
        parsed.data.error.details,
      );
    }
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
