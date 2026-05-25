import { z } from "zod";

// Reusable helper for boolean env vars. Avoid z.coerce.boolean() — it calls
// Boolean(input), and Boolean("false") === true (every non-empty string is
// truthy). This helper accepts either a native boolean (for in-process use)
// or the exact strings "true"/"false" from process.env; anything else
// (typos, "TRUE", "yes", "1", "") throws a ZodError at startup so a
// misconfigured deployment fails loudly instead of silently flipping.
const envBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])], {
    errorMap: () => ({ message: 'must be true, false, "true", or "false"' }),
  })
  .transform((v) => (typeof v === "boolean" ? v : v === "true"));

// Schema is uniformly required across all envs since #223. Test isolation
// lives at the loading layer (apps/api/.env.test, loaded by AppConfigModule
// when NODE_ENV=test) — matches NestJS sample / Spring Boot profile / Rails
// environments convention. Truly optional fields (BENCHMARK_PROCESSOR,
// KUBECONFIG, MCP_*, APP_BASE_URL, prometheus fetcher knobs) stay .optional().
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  // CORS in non-production — comma-separated origin list
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
  // 32-byte base64-encoded AES-256 key used to encrypt user-supplied API
  // keys at rest. The run callback path persists encrypted connection rows.
  CONNECTION_API_KEY_ENCRYPTION_KEY: z.string().refine(
    (v) => {
      // Reject obviously non-base64 input. Buffer.from is permissive (it
      // silently drops invalid chars) so we lint with a regex first.
      if (!/^[A-Za-z0-9+/=]+$/.test(v)) return false;
      return Buffer.from(v, "base64").length === 32;
    },
    { message: "must be a base64 string that decodes to exactly 32 bytes" },
  ),
  // Secret used to derive per-run HMAC callback tokens.
  BENCHMARK_CALLBACK_SECRET: z.string().min(32),
  // K8s job runner config — subprocess driver removed in #101.
  BENCHMARK_CALLBACK_URL: z.string().url(),
  BENCHMARK_K8S_NAMESPACE: z.string().min(1).default("modeldoctor-benchmarks"),
  // K8s watcher (Phase 1: backstop only).
  //   off: informer 不启动（开发本机默认）
  //   backstop: informer 启动，只做 FATAL waiting / terminal-no-callback 兜底
  //   primary: Phase 2 之后才用，本 phase 不实施
  K8S_WATCHER_MODE: z.enum(["off", "backstop", "primary"]).default("off"),
  // 等待状态进 ImagePullBackOff/CrashLoopBackOff 等 FATAL waiting 多久后翻 failed。
  // K8s 社区惯例 60s；registry 限速 / 短暂网络抖动通常 < 30s。
  WAITING_FATAL_GRACE_SEC: z.coerce.number().int().positive().default(60),
  // pod 进终态后给 callback 多少时间到达；超时则 watcher 接管翻 failed。
  // 默认 60s，覆盖 /finish 序列化大 stdout/files + 网络往返。
  TERMINAL_RECONCILE_GRACE_SEC: z.coerce.number().int().positive().default(60),
  // Per-tool runner images (#53 Phase 2 / #78). K8s is the only execution mode.
  RUNNER_IMAGE_GUIDELLM: z.string().min(1),
  RUNNER_IMAGE_VEGETA: z.string().min(1),
  RUNNER_IMAGE_PREFIX_CACHE_PROBE: z.string().min(1),
  RUNNER_IMAGE_EVALSCOPE: z.string().min(1),
  RUNNER_IMAGE_AIPERF: z.string().min(1),
  BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(1800),
  // Optional HuggingFace tokenizer id for guidellm synthetic prompt token
  // counting (passed as --processor). Set this when the target gateway
  // exposes a local model name (e.g. "gen-studio_…") that doesn't resolve
  // on HF — the tokenizer needs to come from somewhere. Example:
  // BENCHMARK_PROCESSOR=Qwen/Qwen2.5-0.5B-Instruct
  BENCHMARK_PROCESSOR: z.string().optional(),
  // Max concurrent in-flight requests for throughput-mode runs.
  // guidellm 0.5.x ThroughputProfile requires this; constant/poisson rate
  // modes ignore it. 100 is a sensible default for medium-tier targets;
  // tune up for high-RPS clusters or down for fragile ones.
  BENCHMARK_DEFAULT_MAX_CONCURRENCY: z.coerce.number().int().positive().default(100),
  // Optional override for the kubeconfig file used by the K8s driver.
  // Out-of-cluster local dev: set this to a specific kubeconfig (e.g. an
  // isolated k3d config) so the driver doesn't pick up your default
  // ~/.kube/config (which may point at a real cluster).
  // In-cluster production: leave unset; @kubernetes/client-node falls back
  // to the in-cluster ServiceAccount automatically.
  KUBECONFIG: z.string().optional(),
  DISABLE_FIRST_USER_ADMIN: envBoolean.default(false),

  // Optional web-app base URL used in outbound notification templates
  // (e.g. the "查看详情" link in dingtalk alert markdown). Leave unset in
  // dev to suppress the link entirely — message body still renders, it
  // just doesn't carry a clickable detail link. In prod, set to the
  // public origin, e.g. https://modeldoctor.example.com.
  APP_BASE_URL: z.string().url().optional(),

  // --- Prometheus fetcher hardening (issue #200) ---
  // Defense-in-depth knobs for the PrometheusFetcherService outbound
  // HTTP. All three are opt-in: the default behaviour preserves the
  // pre-#200 fetch semantics so existing LAN-only deploys aren't broken
  // by an upgrade. See prometheus-fetcher.guard.ts for the policy
  // precedence.
  //
  // When non-empty (comma-separated hostnames), this list IS the policy:
  // anything outside it is rejected and the private-IP check is
  // bypassed (the operator made an explicit choice). Empty / unset
  // means "no allow-list, fall through to PROMETHEUS_FETCH_BLOCK_PRIVATE".
  PROMETHEUS_FETCH_ALLOW_HOSTS: z.string().optional(),
  // When true, reject any URL whose host resolves to a private /
  // loopback / link-local IP. Default false because ModelDoctor
  // typically runs Prometheus on an internal LAN.
  PROMETHEUS_FETCH_BLOCK_PRIVATE: envBoolean.default(false),
  // Upper bound on a single Prometheus response body in bytes. The
  // query_range endpoint streams JSON, so we cap cumulative bytes
  // before parsing to avoid a malicious / misconfigured datasource
  // OOMing the api worker. Default 5 MiB — a 15-minute window at 15s
  // step with 5 series fits in tens of KB, so this is generous.
  PROMETHEUS_FETCH_MAX_BODY_BYTES: z.coerce.number().int().positive().default(5_242_880),

  // --- Alertmanager webhook receiver (P0 closed loop) ---
  // Shared secret for Alertmanager → ModelDoctor webhook. Verified per
  // request via HMAC-SHA256 in the X-ModelDoctor-Signature header.
  // Length matches BENCHMARK_CALLBACK_SECRET.
  ALERTMANAGER_WEBHOOK_SECRET: z.string().min(32),

  // --- MCP server (V1) ---
  // Both must be set together to enable /mcp. When either is unset the
  // MCP route returns 503 ("not configured"). See apps/api/.env.example
  // and apps/api/src/modules/mcp/README.md for bootstrap instructions.
  MCP_BEARER_TOKEN: z.string().min(32).optional(),
  // User ids are Prisma cuid()s, not UUIDs — just require a non-empty
  // string and let the first tool call surface a 404 if it doesn't match.
  MCP_USER_ID: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}
