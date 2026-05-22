import {
  type ChangePasswordRequest,
  ChangePasswordRequestSchema,
  type PublicUser,
  type UpdateProfileRequest,
  UpdateProfileRequestSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { UsersService } from "./users.service.js";

@UseGuards(JwtAuthGuard)
@Controller("me")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: JwtPayload): Promise<PublicUser> {
    const u = await this.users.findById(user.sub);
    return this.users.toPublic(u);
  }

  @Patch()
  async patch(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<PublicUser> {
    return this.users.updateProfile(user.sub, body);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password")
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.users.changePassword(user.sub, body.currentPassword, body.newPassword);
  }
}
