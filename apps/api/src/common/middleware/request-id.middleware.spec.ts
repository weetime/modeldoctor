import { describe, expect, it, vi } from "vitest";
import { RequestIdMiddleware } from "./request-id.middleware.js";

describe("RequestIdMiddleware", () => {
  const mw = new RequestIdMiddleware();

  // biome-ignore lint/suspicious/noExplicitAny: Express Req/Res mocks are intentionally loose.
  function makeReq(header?: string): { req: any; res: any; next: any } {
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    const req: any = { header: vi.fn().mockReturnValue(header) };
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    const res: any = { setHeader: vi.fn() };
    const next = vi.fn();
    return { req, res, next };
  }

  it("generates a 16-char id when header is absent", () => {
    const { req, res, next } = makeReq(undefined);
    mw.use(req, res, next);
    expect(req.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", req.id);
    expect(next).toHaveBeenCalled();
  });

  it("echoes a safe incoming id", () => {
    const { req, res, next } = makeReq("trace-abc123xyz");
    mw.use(req, res, next);
    expect(req.id).toBe("trace-abc123xyz");
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "trace-abc123xyz");
  });

  it("rejects unsafe incoming id and generates new one", () => {
    const { req, res, next } = makeReq("../etc/passwd");
    mw.use(req, res, next);
    expect(req.id).not.toBe("../etc/passwd");
    expect(req.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});
