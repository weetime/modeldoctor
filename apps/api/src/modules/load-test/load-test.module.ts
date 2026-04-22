import { Module } from "@nestjs/common";
import { LoadTestController } from "./load-test.controller.js";
import { LoadTestService } from "./load-test.service.js";

@Module({
  controllers: [LoadTestController],
  providers: [LoadTestService],
})
export class LoadTestModule {}
