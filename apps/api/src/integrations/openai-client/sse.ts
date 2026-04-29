import type { Response } from "express";

/**
 * Pump a Web ReadableStream of SSE bytes to an Express Response, aborting
 * the upstream when the client disconnects (res 'close' event).
 *
 * Caller is responsible for setting Content-Type / Cache-Control headers
 * BEFORE invoking this — we only do byte-level copy + lifecycle.
 */
export async function pipeUpstreamSseToResponse(
  upstream: ReadableStream<Uint8Array>,
  res: Response,
  abort: AbortController,
): Promise<void> {
  const reader = upstream.getReader();
  const onClose = () => {
    if (!abort.signal.aborted) abort.abort();
    reader.cancel().catch(() => {});
  };
  res.on("close", onClose);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(value);
    }
  } finally {
    res.end();
  }
}
