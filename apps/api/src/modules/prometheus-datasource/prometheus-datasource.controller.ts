import {
  type CreatePrometheusDatasource,
  createPrometheusDatasourceSchema,
  type DeletePrometheusDatasourceResponse,
  type ListPrometheusDatasourcesResponse,
  type PrometheusDatasourcePublic,
  type PrometheusDatasourceWithSecret,
  type UpdatePrometheusDatasource,
  updatePrometheusDatasourceSchema,
  type VerifyPrometheusDatasourceRequest,
  type VerifyPrometheusDatasourceResponse,
  verifyPrometheusDatasourceRequestSchema,
  verifyPrometheusDatasourceResponseSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { parseCustomHeaders } from "../../common/http/parse-custom-headers.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { verifyPrometheus } from "../connection/discovery/verify-prometheus.js";
import {
  type PrometheusDatasourceActor,
  PrometheusDatasourceService,
} from "./prometheus-datasource.service.js";

function actorFrom(user: JwtPayload): PrometheusDatasourceActor {
  return { sub: user.sub, isAdmin: user.roles.includes("admin") };
}

@ApiTags("prometheus-datasources")
@ApiBearerAuth()
@Controller("prometheus-datasources")
@UseGuards(JwtAuthGuard)
export class PrometheusDatasourceController {
  constructor(private readonly svc: PrometheusDatasourceService) {}

  @ApiOperation({ summary: "List configured Prometheus datasources" })
  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListPrometheusDatasourcesResponse> {
    return this.svc.list(actorFrom(user));
  }

  @ApiOperation({ summary: "Get a Prometheus datasource by ID" })
  @Get(":id")
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<PrometheusDatasourcePublic> {
    return this.svc.getOne(actorFrom(user), id);
  }

  @ApiOperation({ summary: "Create a Prometheus datasource (admin-only)" })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createPrometheusDatasourceSchema))
    body: CreatePrometheusDatasource,
  ): Promise<PrometheusDatasourceWithSecret> {
    return this.svc.create(actorFrom(user), body);
  }

  @ApiOperation({ summary: "Patch a Prometheus datasource" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePrometheusDatasourceSchema))
    body: UpdatePrometheusDatasource,
  ): Promise<PrometheusDatasourcePublic | PrometheusDatasourceWithSecret> {
    return this.svc.update(actorFrom(user), id, body);
  }

  @ApiOperation({ summary: "Delete a Prometheus datasource" })
  @Delete(":id")
  remove(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<DeletePrometheusDatasourceResponse> {
    return this.svc.remove(actorFrom(user), id);
  }

  @ApiOperation({ summary: "Promote a Prometheus datasource to the default" })
  @Post(":id/set-default")
  setDefault(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<PrometheusDatasourcePublic> {
    return this.svc.setDefault(actorFrom(user), id);
  }

  @ApiOperation({ summary: "Probe a Prometheus URL for buildinfo + version (admin-only)" })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("verify")
  async verify(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(verifyPrometheusDatasourceRequestSchema))
    body: VerifyPrometheusDatasourceRequest,
  ): Promise<VerifyPrometheusDatasourceResponse> {
    if (!actorFrom(user).isAdmin) throw new ForbiddenException("admin role required");

    const result = await verifyPrometheus(body.baseUrl.replace(/\/$/, ""), {
      apiKey: body.bearerToken, // verifyPrometheus → safeFetch sends as Bearer
      extraHeaders: parseCustomHeaders(body.customHeaders),
      method: "GET",
    });
    return verifyPrometheusDatasourceResponseSchema.parse({
      ok: result.ok,
      version: result.version,
      reason: result.reason,
    });
  }
}
