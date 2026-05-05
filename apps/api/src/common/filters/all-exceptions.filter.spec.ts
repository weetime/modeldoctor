import { ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "./all-exceptions.filter.js";

function makeHost(): {
  host: ArgumentsHost;
  response: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    statusCode: number;
    body: unknown;
  };
} {
  const captured: { statusCode: number; body: unknown } = { statusCode: 0, body: undefined };
  const response = {
    status: vi.fn((code: number) => {
      captured.statusCode = code;
      return response;
    }),
    json: vi.fn((b: unknown) => {
      captured.body = b;
      return response;
    }),
    get statusCode() {
      return captured.statusCode;
    },
    get body() {
      return captured.body;
    },
  };
  const request: Partial<Request> = { id: "test-req-1" } as Partial<Request>;
  const host = {
    switchToHttp: () => ({
      getResponse: () => response as unknown as Response,
      getRequest: () => request as unknown as Request,
    }),
  } as unknown as ArgumentsHost;
  return { host, response: response as never };
}

describe("AllExceptionsFilter", () => {
  const filter = new AllExceptionsFilter();

  it("case 1: HttpException with no body → uses HTTP-status default code", () => {
    const { host, response } = makeHost();
    filter.catch(new HttpException("", HttpStatus.NOT_FOUND), host);
    expect(response.statusCode).toBe(404);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("case 2: HttpException with string body → message = string, code = HTTP-status default", () => {
    const { host, response } = makeHost();
    filter.catch(new HttpException("some message", HttpStatus.FORBIDDEN), host);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("some message");
  });

  it("case 3: HttpException with {message} body → message preserved, code = HTTP-status default", () => {
    const { host, response } = makeHost();
    filter.catch(new HttpException({ message: "custom msg" }, HttpStatus.CONFLICT), host);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toBe("custom msg");
  });

  it("case 4: HttpException with registered domain code → domain code surfaces", () => {
    const { host, response } = makeHost();
    filter.catch(
      new ForbiddenException({
        message: "template forbidden",
        code: "BENCHMARK_TEMPLATE_FORBIDDEN",
      }),
      host,
    );
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BENCHMARK_TEMPLATE_FORBIDDEN");
    expect(body.error.message).toBe("template forbidden");
    expect(response.statusCode).toBe(403);
  });

  it("case 5: HttpException with unregistered code → falls back to HTTP-status default", () => {
    const { host, response } = makeHost();
    filter.catch(
      new ForbiddenException({ message: "oops", code: "NOT_YET_REGISTERED_CODE" }),
      host,
    );
    const body = response.body as { error: { code: string; message: string } };
    // Unregistered code must NOT surface; falls back to FORBIDDEN
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("case 6: HttpException 400 with {message, details} → VALIDATION_FAILED overrides domain code", () => {
    const { host, response } = makeHost();
    filter.catch(
      new HttpException(
        { message: "bad input", code: "BENCHMARK_PARAMS_INVALID", details: [{ field: "x" }] },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );
    const body = response.body as { error: { code: string; details?: unknown } };
    // VALIDATION_FAILED wins even though domain code was registered
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toEqual([{ field: "x" }]);
  });

  it("case 7: generic Error (non-HttpException) → 500 + INTERNAL_SERVER_ERROR", () => {
    const { host, response } = makeHost();
    filter.catch(new Error("something blew up"), host);
    expect(response.statusCode).toBe(500);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.message).toBe("something blew up");
  });

  it("case 8: unknown thrown value (throw string) → 500 + INTERNAL_SERVER_ERROR", () => {
    const { host, response } = makeHost();
    filter.catch("something unexpected", host);
    expect(response.statusCode).toBe(500);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.message).toBe("Internal server error");
  });

  it("case 9: non-string code in body (code: 123) → falls back to HTTP-status default", () => {
    const { host, response } = makeHost();
    filter.catch(new HttpException({ message: "bad", code: 123 }, HttpStatus.BAD_REQUEST), host);
    const body = response.body as { error: { code: string } };
    // code 123 is not a string, so falls back to BAD_REQUEST
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("requestId from request is forwarded to error body", () => {
    const { host, response } = makeHost();
    filter.catch(new HttpException("err", HttpStatus.NOT_FOUND), host);
    const body = response.body as { error: { requestId: string } };
    expect(body.error.requestId).toBe("test-req-1");
  });
});
