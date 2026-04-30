import { useAuthStore } from "@/stores/auth-store";
import { ApiError } from "./api-client";

export interface PlaygroundFetchMultipartInput {
  path: string;
  form: FormData;
  signal?: AbortSignal;
}

/**
 * POSTs FormData to a Playground endpoint that speaks multipart/form-data.
 * Crucially does NOT set Content-Type on the request — fetch derives the
 * multipart boundary from the FormData body, and any explicit value
 * would prevent the boundary from being attached and break parsing on
 * the server.
 */
export async function playgroundFetchMultipart<T>({
  path,
  form,
  signal,
}: PlaygroundFetchMultipartInput): Promise<T> {
  const headers = new Headers();
  const tok = useAuthStore.getState().accessToken;
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: form,
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      if (body.message) message = body.message;
      if (body.code) code = body.code;
    } catch {
      // body wasn't JSON — keep the generic message
    }
    throw new ApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}
