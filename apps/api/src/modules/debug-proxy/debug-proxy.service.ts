import { Injectable } from "@nestjs/common";
import type {
  DebugProxyRequest,
  DebugProxyResponse,
} from "@modeldoctor/contracts";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

function looksBinary(contentType: string): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith("image/") ||
    contentType.startsWith("audio/") ||
    contentType.startsWith("video/") ||
    contentType === "application/octet-stream"
  );
}

@Injectable()
export class DebugProxyService {
  async forward(req: DebugProxyRequest): Promise<DebugProxyResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    const startedAt = Date.now();
    let ttfbAt: number | null = null;

    try {
      const init: RequestInit = {
        method: req.method,
        headers: req.headers,
        signal: controller.signal,
      };
      if (
        req.body !== null &&
        req.body !== undefined &&
        req.method !== "GET" &&
        req.method !== "HEAD"
      ) {
        init.body = req.body;
      }
      const response = await fetch(req.url, init);
      ttfbAt = Date.now();

      const contentType = response.headers.get("content-type") ?? "";
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_BODY_BYTES) {
        return {
          success: false,
          error: `Response body exceeds ${MAX_BODY_BYTES} bytes`,
        };
      }

      const binary = looksBinary(contentType);
      const body = binary
        ? buffer.toString("base64")
        : buffer.toString("utf-8");
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers,
        body,
        bodyEncoding: binary ? "base64" : "text",
        timingMs: {
          ttfbMs: ttfbAt - startedAt,
          totalMs: Date.now() - startedAt,
        },
        sizeBytes: buffer.byteLength,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Request timeout / aborted"
          : err instanceof Error
            ? err.message
            : String(err);
      return { success: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
