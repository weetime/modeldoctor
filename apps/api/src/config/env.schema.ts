import { z } from "zod";

// Reusable helper for boolean env vars. Avoid z.coerce.boolean() — it calls
// Boolean(input), and Boolean("false") === true (every non-empty string is
// truthy). This helper accepts either a native boolean (for in-process use)
// or the exact strings "true"/"false" from process.env; anything else
// (typos, "TRUE", "yes", "1", "") throws a ZodError at startup so a
// misconfigured deployment fails loudly instead of silently flipping.
const envBoolean = z
  .union(
    [z.boolean(), z.enum(["true", "false"])],
    { errorMap: () => ({ message: 'must be true, false, "true", or "false"' }) },
  )
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
