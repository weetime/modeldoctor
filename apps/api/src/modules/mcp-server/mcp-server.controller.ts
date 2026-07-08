import {
  type CreateMcpServer,
  createMcpServerSchema,
  type ListMcpServersResponse,
  type McpServerPublic,
  type McpServerWithSecret,
  type UpdateMcpServer,
  updateMcpServerSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { McpServerService } from "./mcp-server.service.js";

@ApiTags("mcp-servers")
@ApiBearerAuth()
@Controller("mcp-servers")
@UseGuards(JwtAuthGuard)
export class McpServerController {
  constructor(private readonly service: McpServerService) {}

  @ApiOperation({ summary: "List MCP servers owned by the user" })
  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListMcpServersResponse> {
    return this.service.list(user.sub);
  }

  @ApiOperation({ summary: "Register a new MCP server (the response carries the auth token once)" })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createMcpServerSchema)) body: CreateMcpServer,
  ): Promise<McpServerWithSecret> {
    return this.service.create(user.sub, body);
  }

  @ApiOperation({ summary: "Get an MCP server by ID (token is omitted from the response)" })
  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<McpServerPublic> {
    return this.service.findOwnedPublic(user.sub, id);
  }

  @ApiOperation({ summary: "Patch an MCP server (re-encrypts the token when supplied)" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMcpServerSchema)) body: UpdateMcpServer,
  ): Promise<McpServerWithSecret | McpServerPublic> {
    return this.service.update(user.sub, id, body);
  }

  @ApiOperation({ summary: "Delete an MCP server" })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
