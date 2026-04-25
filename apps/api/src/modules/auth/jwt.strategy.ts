import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Env } from "../../config/env.schema.js";

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    // JWT_ACCESS_SECRET is typed `string | undefined` because the env schema
    // marks it `.optional()` at the object level (superRefine makes it required
    // when NODE_ENV !== "test"). Coalesce to an empty string: in non-test modes
    // validateEnv() has already rejected a missing secret at boot, so this
    // branch is unreachable there. In test mode specs that actually exercise
    // JWT verification must set JWT_ACCESS_SECRET themselves.
    const secret = config.get("JWT_ACCESS_SECRET", { infer: true }) ?? "";
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
