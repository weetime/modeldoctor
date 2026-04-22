import { Module } from "@nestjs/common";
import { E2ETestController } from "./e2e-test.controller.js";
import { E2ETestService } from "./e2e-test.service.js";

@Module({
  controllers: [E2ETestController],
  providers: [E2ETestService],
})
export class E2ETestModule {}
