import type { AuthTokenResponse, PublicUser } from "@modeldoctor/contracts";
import {
  type LoginRequest,
  LoginRequestSchema,
  type RegisterRequest,
  RegisterRequestSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public } from "../../common/decorators/public.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { Env } from "../../config/env.schema.js";
import { UsersService } from "../users/users.service.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import type { JwtPayload } from "./jwt.strategy.js";

const REFRESH_COOKIE = "md_refresh";

function setRefreshCookie(res: Response, token: string, maxAgeDays: number, isProd: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
    path: "/api/auth",
    maxAge: maxAgeDays * 86_400_000,
  });
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post("register")
  async register(
    @Body(new ZodValidationPipe(RegisterRequestSchema)) body: RegisterRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const { accessToken, refreshToken, user } = await this.auth.register(body.email, body.password);
    setRefreshCookie(
      res,
      refreshToken,
      this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
      this.config.get("NODE_ENV", { infer: true }) === "production",
    );
    return { accessToken, user };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const { accessToken, refreshToken, user } = await this.auth.login(body.email, body.password);
    setRefreshCookie(
      res,
      refreshToken,
      this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
      this.config.get("NODE_ENV", { infer: true }) === "production",
    );
    return { accessToken, user };
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!presented) throw new UnauthorizedException("No refresh cookie");
    const result = await this.auth.refresh(presented);
    if (result.kind === "rotated") {
      setRefreshCookie(
        res,
        result.refreshToken,
        this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
        this.config.get("NODE_ENV", { infer: true }) === "production",
      );
    }
    // Grace-replayed: do not touch the cookie — the legitimate caller's
    // freshly-issued cookie is already in the browser's jar.
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("logout")
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (presented) await this.auth.logout(presented);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@Req() req: Request & { user: JwtPayload }): Promise<PublicUser> {
    const user = await this.users.findById(req.user.sub);
    return this.users.toPublic(user);
  }
}
