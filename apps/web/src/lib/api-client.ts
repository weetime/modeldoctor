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

// Serialize concurrent refresh attempts so multiple 401s only issue ONE refresh.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    const p: Promise<string | null> = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { accessToken: string; user: PublicUser };
        useAuthStore.getState().setAuth(body.accessToken, body.user);
        return body.accessToken;
      } catch {
        return null;
      }
    })();
    refreshInFlight = p;
    // Identity check: if another refresh took over before this one settled,
    // don't clobber the newer promise reference.
    p.finally(() => {
      if (refreshInFlight === p) refreshInFlight = null;
    });
  }
  return refreshInFlight;
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
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(newToken);
    } else {
      useAuthStore.getState().clear();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      throw new ApiError(401, "Unauthorized");
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
