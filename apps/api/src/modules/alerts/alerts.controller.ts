import { timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { Env } from "../../config/env.schema.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import {
  type AlertmanagerPayload,
  alertmanagerPayloadSchema,
  type ListAlertsQuery,
  listAlertsQuerySchema,
} from "./alerts.dto.js";
import { AlertsService } from "./alerts.service.js";
import { AlertExplainerService } from "./explainer.service.js";

@Controller("alerts")
export class AlertsController {
  private readonly log = new Logger(AlertsController.name);

  constructor(
    private readonly alerts: AlertsService,
    private readonly explainer: AlertExplainerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Alertmanager → ModelDoctor webhook. PUBLIC: no JWT (Alertmanager won't
   * have one). Authenticated via shared bearer token in the Authorization
   * header, compared in constant time.
   *
   * Alertmanager config (v0.27+):
   *   receivers:
   *     - name: modeldoctor
   *       webhook_configs:
   *         - url: https://modeldoctor.example.com/api/alerts/webhook
   *           http_config:
   *             authorization:
   *               type: Bearer
   *               credentials: <shared-secret matching ALERTMANAGER_WEBHOOK_SECRET>
   */
  @Public()
  @Post("webhook")
  @HttpCode(202)
  async webhook(
    @Headers("authorization") auth: string | undefined,
    @Body(new ZodValidationPipe(alertmanagerPayloadSchema)) body: AlertmanagerPayload,
  ): Promise<{ accepted: number; created: number }> {
    this.verifyAuth(auth);
    const { created } = await this.alerts.ingest(body);

    // Fire-and-forget AI explanation for newly-created rows. Awaiting here
    // would block Alertmanager retries; the explainer writes to DB
    // independently and the UI surfaces it when ready.
    //
    // Explanations are processed sequentially to bound concurrent LLM
    // calls — a single batch can carry many alerts (Alertmanager groups
    // by labelSet), and parallel fan-out would pile up Prisma + LLM
    // connections and risk hitting provider rate limits. Serial keeps
    // resource use predictable at the cost of total latency.
    void this.processExplanationsSequentially(created);

    return { accepted: body.alerts.length, created: created.length };
  }

  private async processExplanationsSequentially(alertEventIds: string[]): Promise<void> {
    for (const id of alertEventIds) {
      try {
        await this.explainer.explainAsync(id);
      } catch (err) {
        this.log.warn(`Explainer failed for alert ${id}: ${(err as Error).message}`);
      }
    }
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listAlertsQuerySchema)) query: ListAlertsQuery,
  ) {
    return this.alerts.listForUser(user.sub, query);
  }

  @Get(":id")
  async get(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    const row = await this.alerts.getForUser(user.sub, id);
    if (!row) throw new NotFoundException("alert not found");
    return row;
  }

  private verifyAuth(authHeader: string | undefined): void {
    const secret = this.config.get("ALERTMANAGER_WEBHOOK_SECRET", { infer: true });
    if (!secret) {
      throw new UnauthorizedException("ALERTMANAGER_WEBHOOK_SECRET not configured on server");
    }
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing Bearer token");
    }
    const presented = Buffer.from(authHeader.slice("Bearer ".length));
    const expected = Buffer.from(secret);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new UnauthorizedException("invalid webhook bearer token");
    }
  }
}
