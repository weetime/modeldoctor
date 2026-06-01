// apps/api/src/modules/mcp/confirm-token.service.spec.ts
import { describe, expect, it } from "vitest";
import { ConfirmTokenService } from "./confirm-token.service.js";

function svc() {
  // ConfigService stub: only get("MCP_BEARER_TOKEN") is read.
  const config = { get: () => "x".repeat(40) } as unknown as ConstructorParameters<
    typeof ConfirmTokenService
  >[0];
  return new ConfirmTokenService(config);
}

const T0 = 1_750_000_000_000;

describe("ConfirmTokenService", () => {
  it("issues a token that verifies for the same action+payload", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { connectionId: "c1", tool: "guidellm" }, T0);
    expect(s.verify("run_benchmark", { connectionId: "c1", tool: "guidellm" }, token, T0)).toEqual({
      ok: true,
    });
  });

  it("is order-insensitive on payload keys (stable stringify)", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { a: 1, b: 2 }, T0);
    expect(s.verify("run_benchmark", { b: 2, a: 1 }, token, T0).ok).toBe(true);
  });

  it("rejects a changed payload", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { connectionId: "c1" }, T0);
    expect(s.verify("run_benchmark", { connectionId: "c2" }, token, T0).ok).toBe(false);
  });

  it("rejects a token issued for a different action", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { x: 1 }, T0);
    expect(s.verify("run_quality_gate", { x: 1 }, token, T0)).toEqual({
      ok: false,
      reason: "action_mismatch",
    });
  });

  it("reports signature_mismatch on a changed payload (not action/expiry)", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { connectionId: "c1" }, T0);
    expect(s.verify("run_benchmark", { connectionId: "c2" }, token, T0)).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects an expired token (> 10 min)", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { x: 1 }, T0);
    expect(s.verify("run_benchmark", { x: 1 }, token, T0 + 11 * 60_000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a future-dated token (clock skew / pre-minted)", () => {
    const s = svc();
    const token = s.issue("run_benchmark", { x: 1 }, T0 + 20 * 60_000);
    expect(s.verify("run_benchmark", { x: 1 }, token, T0)).toEqual({
      ok: false,
      reason: "not_yet_valid",
    });
  });

  it("rejects a malformed token", () => {
    const s = svc();
    expect(s.verify("run_benchmark", { x: 1 }, "not-a-token", T0).ok).toBe(false);
  });
});
