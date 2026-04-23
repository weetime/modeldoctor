import {
  type LoadTestRequest,
  LoadTestRequestSchema,
  type LoadTestResponse,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { LoadTestService } from "./load-test.service.js";

@Controller()
export class LoadTestController {
  constructor(private readonly svc: LoadTestService) {}

  @Post("load-test")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(LoadTestRequestSchema))
  run(@Body() body: LoadTestRequest): Promise<LoadTestResponse> {
    return this.svc.run(body);
  }
}
