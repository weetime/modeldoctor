import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";
import { verifyCallbackToken } from "./hmac-token.js";

interface CallbackRequest {
  headers: { authorization?: string };
  params: { id?: string };
}

@Injectable()
export class HmacCallbackGuard implements CanActivate {
  private readonly secret: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const raw = config.get("BENCHMARK_CALLBACK_SECRET", { infer: true });
    if (!raw) {
      throw new Error(
        "HmacCallbackGuard: BENCHMARK_CALLBACK_SECRET is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.secret = Buffer.from(raw, "utf8");
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<CallbackRequest>();
    const authz = req.headers.authorization;
    if (!authz?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or non-Bearer Authorization");
    }
    const id = req.params.id;
    if (!id) throw new UnauthorizedException("Missing :id route param");
    const token = authz.slice("Bearer ".length);
    if (!verifyCallbackToken(id, token, this.secret)) {
      throw new UnauthorizedException("Invalid callback token");
    }
    return true;
  }
}
