import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Base JWT guard. Task 5.5 will extend this to honor `@Public()` via Reflector
 * and register it globally as an `APP_GUARD`. For now it is only attached
 * explicitly via `@UseGuards(JwtAuthGuard)` on protected routes such as
 * `GET /api/auth/me`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
