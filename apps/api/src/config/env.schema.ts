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
    // keys at rest. Optional in Phase 1 (the helper is added but no row uses
    // it yet); Phase 4 tightens to required-when-not-test once the
    // BenchmarkController persists encrypted rows.
    BENCHMARK_API_KEY_ENCRYPTION_KEY: z
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
