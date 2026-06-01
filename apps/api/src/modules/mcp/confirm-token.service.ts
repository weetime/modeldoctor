// apps/api/src/modules/mcp/confirm-token.service.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";

const TTL_MS = 10 * 60_000;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Stateless dry-run→confirm tokens for execute-class MCP tools. The token
 * binds (action, canonical payload, issue time) under an HMAC keyed by
 * MCP_BEARER_TOKEN — so a token issued by a dry-run for one request cannot be
 * replayed against a different payload (agent can't swap small dry-run params
 * for big real ones) or after it expires. No DB, no revocation list.
 */
@Injectable()
export class ConfirmTokenService {
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    // MCP routes are 503 unless MCP_BEARER_TOKEN is set (see mcp.guard.ts), so
    // by the time any execute tool runs this is always present.
    this.secret = config.get("MCP_BEARER_TOKEN", { infer: true }) ?? "mcp-confirm-fallback";
  }

  issue(action: string, payload: unknown, nowMs: number = Date.now()): string {
    const ts = nowMs;
    const sig = this.sign(action, payload, ts);
    // Carry action + ts in the token so verify can distinguish a wrong-action
    // token from a tampered payload, and enforce expiry without a store.
    return Buffer.from(JSON.stringify({ action, ts, sig }), "utf8").toString("base64url");
  }

  verify(
    action: string,
    payload: unknown,
    token: string,
    nowMs: number = Date.now(),
  ): VerifyResult {
    let decoded: { action?: string; ts?: number; sig?: string };
    try {
      decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (
      typeof decoded.action !== "string" ||
      typeof decoded.ts !== "number" ||
      typeof decoded.sig !== "string"
    ) {
      return { ok: false, reason: "malformed" };
    }
    if (decoded.action !== action) return { ok: false, reason: "action_mismatch" };
    if (nowMs - decoded.ts > TTL_MS) return { ok: false, reason: "expired" };
    // Reject future-dated tokens (clock skew or a pre-minted token): without
    // this, a negative age is never > TTL so the token would never expire.
    if (decoded.ts - nowMs > TTL_MS) return { ok: false, reason: "not_yet_valid" };
    const expected = this.sign(decoded.action, payload, decoded.ts);
    const a = Buffer.from(decoded.sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "signature_mismatch" };
    }
    return { ok: true };
  }

  private sign(action: string, payload: unknown, ts: number): string {
    const body = `${action}\n${stableStringify(payload)}\n${ts}`;
    return createHmac("sha256", this.secret).update(body).digest("hex");
  }
}

/** Deterministic JSON: object keys sorted recursively so key order never
 * changes the signature. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  // Mirror JSON.stringify's null-coercion for undefined array holes so two
  // distinct payloads can't collapse to the same string (`[1,,3]`).
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
