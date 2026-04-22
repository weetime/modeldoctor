export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface KeyValueRow {
  key: string;
  value: string;
  enabled: boolean;
}

export interface DebugResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "text" | "base64";
  timingMs: { ttfbMs: number; totalMs: number };
  sizeBytes: number;
}

/** Wire format returned by `POST /api/debug/proxy`. */
export interface DebugProxyResponse {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: "text" | "base64";
  timingMs?: { ttfbMs: number; totalMs: number };
  sizeBytes?: number;
  error?: string;
}
