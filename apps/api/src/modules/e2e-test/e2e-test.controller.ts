import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
} from "@nestjs/common";
import { E2ETestService } from "./e2e-test.service.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  E2ETestRequestSchema,
  type E2ETestRequest,
  type E2ETestResponse,
} from "@modeldoctor/contracts";

@Controller()
export class E2ETestController {
  constructor(private readonly svc: E2ETestService) {}

  @Post("e2e-test")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(E2ETestRequestSchema))
  run(@Body() body: E2ETestRequest): Promise<E2ETestResponse> {
    return this.svc.run(body);
  }
}
