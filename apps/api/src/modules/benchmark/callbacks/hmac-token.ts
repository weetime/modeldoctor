import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs an HMAC callback token used by runner pods to authenticate against
 * `/api/internal/benchmarks/:id/{state,metrics}`. Format: "<exp>.<hex-sig>"
 * where `sig = HMAC_SHA256(secret, "<id>.<exp>")`. The id is *not* embedded
 * in the token — the verifier reads it from the URL path and reconstructs
 * the message, which prevents cross-id replay.
 */
export function signCallbackToken(
  id: string,
  secret: Buffer,
  ttlSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const exp = nowSeconds + ttlSeconds;
  const sig = createHmac("sha256", secret).update(`${id}.${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyCallbackToken(
  id: string,
  token: string,
  secret: Buffer,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expStr, sigHex] = parts;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || String(exp) !== expStr) return false;
  if (nowSeconds > exp) return false;
  const expectedHex = createHmac("sha256", secret).update(`${id}.${exp}`).digest("hex");
  if (sigHex.length !== expectedHex.length) return false;
  return timingSafeEqual(Buffer.from(sigHex, "utf8"), Buffer.from(expectedHex, "utf8"));
}
