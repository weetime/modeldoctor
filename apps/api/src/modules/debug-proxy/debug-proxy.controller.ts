import {
  type DebugProxyRequest,
  DebugProxyRequestSchema,
  type DebugProxyResponse,
  DebugProxyResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { DebugProxyService } from "./debug-proxy.service.js";

class DebugProxyRequestDto extends createZodDto(DebugProxyRequestSchema) {}
// DebugProxyResponseSchema is a z.discriminatedUnion, whose inferred TOutput is
// a union type — TS can't extend a class whose base-constructor return type is a
// union. Assign the factory result directly and rename the class so Swagger
// emits a stable `DebugProxyResponseDto` component (default: `AugmentedZodDto`).
const DebugProxyResponseDto = createZodDto(DebugProxyResponseSchema);
Object.defineProperty(DebugProxyResponseDto, "name", { value: "DebugProxyResponseDto" });

@ApiTags("debug-proxy")
@Controller("debug")
export class DebugProxyController {
  constructor(private readonly proxy: DebugProxyService) {}

  @ApiOperation({ summary: "Proxy an upstream HTTP request and return the decoded response" })
  @ApiBody({ type: DebugProxyRequestDto })
  @ApiOkResponse({ type: DebugProxyResponseDto })
  @Post("proxy")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(DebugProxyRequestSchema))
  forward(@Body() body: DebugProxyRequest): Promise<DebugProxyResponse> {
    return this.proxy.forward(body);
  }
}
