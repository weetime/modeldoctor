import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Env } from "../../config/env.schema.js";
import type { JwtPayload } from "./jwt.strategy.js";

/** Passport strategy for SSE endpoints only.
 *  EventSource cannot set custom headers so the JWT is accepted via the
 *  `?token=` query param in addition to the Authorization header.
 *  Registered as 'jwt-sse'; used exclusively by @UseGuards(SseJwtAuthGuard). */
@Injectable()
export class JwtSseStrategy extends PassportStrategy(Strategy, "jwt-sse") {
  constructor(config: ConfigService<Env, true>) {
    const secret = config.get("JWT_ACCESS_SECRET", { infer: true }) ?? "";
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // biome-ignore lint/suspicious/noExplicitAny: passport-jwt req is untyped
        (req: any) => {
          const t = req?.query?.token;
          return typeof t === "string" ? t : null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
