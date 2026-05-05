import { type ErrorCode, ErrorCodes } from "@modeldoctor/contracts";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

function httpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCodes.BAD_REQUEST;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCodes.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ErrorCodes.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCodes.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCodes.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCodes.TOO_MANY_REQUESTS;
    default:
      return ErrorCodes.INTERNAL_SERVER_ERROR;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.id ?? "";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCodes.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = httpStatusToCode(status);
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const rec = body as Record<string, unknown>;
        if (typeof rec.message === "string") {
          message = rec.message;
        } else if (Array.isArray(rec.message)) {
          message = rec.message.join("; ");
        } else {
          message = exception.message;
        }
        if ("details" in rec) {
          details = rec.details;
        }
        // Domain-specific code override: if the exception body carries an explicit
        // `code` string (e.g. "BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN"), use it
        // instead of the generic HTTP-status-derived code so client UIs can switch on it.
        // Only registered codes pass through; unregistered ones fall back to the
        // HTTP-status default (forces devs to register new codes in ErrorCodes first).
        if (typeof rec.code === "string" && Object.hasOwn(ErrorCodes, rec.code)) {
          code = rec.code as ErrorCode;
        }
      } else {
        message = exception.message;
      }
      // VALIDATION_FAILED refinement for 400s that carry structured details (ZodValidationPipe)
      if (status === HttpStatus.BAD_REQUEST && details !== undefined) {
        code = ErrorCodes.VALIDATION_FAILED;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error({ requestId, err: exception }, "Unhandled exception");
    }

    response.status(status).json({
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        requestId,
      },
    });
  }
}
