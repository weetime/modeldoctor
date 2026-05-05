import type { ZodError } from "zod";

/**
 * Convert a ZodError to a human-friendly multi-line string. Each issue becomes
 * `path.to.field: message`. Use this anywhere a ZodError is being surfaced
 * to a client via an exception body — the raw `error.message` is a
 * stringified JSON array that's incomprehensible in the UI.
 *
 * Example:
 *   `rateType: Required` instead of
 *   `[{"expected":"...","received":"undefined","code":"invalid_type",...}]`
 */
export function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
