import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

const HEADER_NAME = "x-request-id";
/** Accept client-provided request ids that look "safe" — alphanumeric + dashes, 8-64 chars. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER_NAME);
    const id = incoming && SAFE_ID.test(incoming) ? incoming : nanoid(16);
    req.id = id;
    res.setHeader(HEADER_NAME, id);
    next();
  }
}
