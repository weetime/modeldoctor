import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Auth guard for SSE endpoints; uses the jwt-sse strategy which additionally
 *  accepts the JWT via `?token=` query param (EventSource cannot set headers). */
@Injectable()
export class SseJwtAuthGuard extends AuthGuard("jwt-sse") {}
