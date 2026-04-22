import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
} from "@nestjs/common";
import { DebugProxyService } from "./debug-proxy.service.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  DebugProxyRequestSchema,
  type DebugProxyRequest,
  type DebugProxyResponse,
} from "@modeldoctor/contracts";

@Controller("debug")
export class DebugProxyController {
  constructor(private readonly proxy: DebugProxyService) {}

  @Post("proxy")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(DebugProxyRequestSchema))
  forward(@Body() body: DebugProxyRequest): Promise<DebugProxyResponse> {
    return this.proxy.forward(body);
  }
}
