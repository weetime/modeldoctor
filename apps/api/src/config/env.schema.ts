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

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),

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

    // Required when NODE_ENV !== "test"; optional in test mode so non-DB e2e specs
    // can load AppModule without a live database.
    DATABASE_URL: z.string().url().optional(),
    JWT_ACCESS_SECRET: z.string().min(32).optional(),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
    // 32-byte base64-encoded AES-256 key used to encrypt user-supplied API
    // keys at rest. Optional in dev/test; required in production once the
    // run callback path persists encrypted connection rows.
    CONNECTION_API_KEY_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (v === undefined) return true;
          // Reject obviously non-base64 input. Buffer.from is permissive (it
          // silently drops invalid chars) so we lint with a regex first.
          if (!/^[A-Za-z0-9+/=]+$/.test(v)) return false;
          return Buffer.from(v, "base64").length === 32;
        },
        { message: "must be a base64 string that decodes to exactly 32 bytes" },
      ),
    // Secret used to derive per-run HMAC callback tokens. Phase 3 enforces;
    // Phase 1 only validates length when present.
    BENCHMARK_CALLBACK_SECRET: z.string().min(32).optional(),
    // Phase 3 driver + k8s config — full validation in Task 9
    BENCHMARK_DRIVER: z.enum(["subprocess", "k8s"]).default("subprocess"),
    BENCHMARK_CALLBACK_URL: z.string().url().optional(),
    BENCHMARK_K8S_NAMESPACE: z.string().min(1).default("modeldoctor-benchmarks"),
    // #53 Phase 2 (#78): per-tool runner images, required when k8s driver.
    RUNNER_IMAGE_GUIDELLM: z.string().min(1).optional(),
    RUNNER_IMAGE_GENAI_PERF: z.string().min(1).optional(),
    RUNNER_IMAGE_VEGETA: z.string().min(1).optional(),
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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "test" && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.JWT_ACCESS_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_ACCESS_SECRET"],
        message: "JWT_ACCESS_SECRET is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.CONNECTION_API_KEY_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CONNECTION_API_KEY_ENCRYPTION_KEY"],
        message: "CONNECTION_API_KEY_ENCRYPTION_KEY is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.BENCHMARK_CALLBACK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BENCHMARK_CALLBACK_SECRET"],
        message: "BENCHMARK_CALLBACK_SECRET is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.BENCHMARK_CALLBACK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BENCHMARK_CALLBACK_URL"],
        message: "BENCHMARK_CALLBACK_URL is required when NODE_ENV is not 'test'",
      });
    }
    if (env.BENCHMARK_DRIVER === "k8s") {
      const perToolImages = [
        "RUNNER_IMAGE_GUIDELLM",
        "RUNNER_IMAGE_VEGETA",
        "RUNNER_IMAGE_GENAI_PERF",
      ] as const;
      for (const key of perToolImages) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when BENCHMARK_DRIVER='k8s'`,
          });
        }
      }
    }
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
