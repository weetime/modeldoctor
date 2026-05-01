import { Module } from "@nestjs/common";
import { RunModule } from "../run/run.module.js";
import { E2ETestController } from "./e2e-test.controller.js";
import { E2ETestService } from "./e2e-test.service.js";

@Module({
  imports: [RunModule],
  controllers: [E2ETestController],
  providers: [E2ETestService],
})
export class E2ETestModule {}
