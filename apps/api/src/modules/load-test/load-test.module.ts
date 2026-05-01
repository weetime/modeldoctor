import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { RunModule } from "../run/run.module.js";
import { LoadTestController } from "./load-test.controller.js";
import { LoadTestService } from "./load-test.service.js";

@Module({
  imports: [RunModule, ConnectionModule],
  controllers: [LoadTestController],
  providers: [LoadTestService],
})
export class LoadTestModule {}
