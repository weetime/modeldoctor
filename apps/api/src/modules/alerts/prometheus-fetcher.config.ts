// apps/api/src/modules/alerts/prometheus-fetcher.config.ts
import type { SsrfGuardConfig } from "./prometheus-fetcher.guard.js";

/**
 * Combined runtime configuration for `PrometheusFetcherService`. Built
 * from env at module-init via the factory in alerts.module.ts; injected
 * into the service by token to keep the service constructor signature
 * stable for unit tests that already `new` the service directly.
 */
export interface PrometheusFetcherConfig {
  guard: SsrfGuardConfig;
  maxBodyBytes: number;
}

export const PROMETHEUS_FETCHER_CONFIG = "PROMETHEUS_FETCHER_CONFIG";
