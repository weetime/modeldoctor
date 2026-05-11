export interface ProbeCtx {
  /** baseUrl already validated by assertSafeUrl. No trailing slash. */
  baseUrl: string;
  /** Optional Bearer token, forwarded by safeFetch. */
  apiKey?: string;
  /**
   * Caller-supplied gateway routing headers (e.g. Higress `x-higress-llm-model`).
   * Forwarded verbatim to every probe request. Already parsed from the user-
   * facing newline-separated string by DiscoveryService.
   */
  extraHeaders?: Record<string, string>;
}

export interface ProbeResult<T = unknown> {
  ok: boolean;
  /** Wall-clock duration of the probe in ms. */
  durationMs: number;
  /** Probe-specific parsed data. Populated only when ok === true. */
  data?: T;
  /** Short failure reason. Populated only when ok === false. */
  reason?: string;
}

export type ModelsProbeData = {
  models: string[];
  /** Raw `/v1/models` response object — used by inference rules that want to look at extra fields like `served_model_name`. */
  raw: unknown;
};

export type MetricsProbeData = {
  /** Raw `/metrics` body (plaintext Prometheus exposition format), trimmed to first 64 KiB. */
  body: string;
};

export type HealthProbeData = {
  /** Which path responded 2xx — `/health` or `/healthz` or null if neither did. */
  path: "/health" | "/healthz";
};

export type ServerHeaderProbeData = {
  /** Lowercased value of `Server` header, or null. */
  server: string | null;
  /** Lowercased value of `X-Powered-By` header, or null. */
  poweredBy: string | null;
};
