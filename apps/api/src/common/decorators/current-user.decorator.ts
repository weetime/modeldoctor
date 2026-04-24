import { type ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { JwtPayload } from "../../modules/auth/jwt.strategy.js";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    return req.user;
  },
);
