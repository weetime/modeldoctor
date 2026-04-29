import { useAuthStore } from "@/stores/auth-store";

export interface PlaygroundFetchStreamInput {
  path: string;
  body: unknown;
  signal: AbortSignal;
  onSseEvent: (data: string) => void;
}

/**
 * POSTs body to path and parses the SSE response, invoking onSseEvent for
 * each `data: <payload>` line. Caller passes an AbortSignal to stop the
 * stream; we cancel the underlying reader on abort.
 *
 * Used for /api/playground/chat with stream:true. EventSource is not used
 * because it does not support POST or Authorization headers.
 */
export async function playgroundFetchStream({
  path,
  body,
  signal,
  onSseEvent,
}: PlaygroundFetchStreamInput): Promise<void> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const tok = useAuthStore.getState().accessToken;
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Stream response had no body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Split by SSE event boundary: \n\n
      let idx = buf.indexOf("\n\n");
      while (idx !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of event.split("\n")) {
          if (line.startsWith("data:")) onSseEvent(line.slice(5).trimStart());
        }
        idx = buf.indexOf("\n\n");
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}
