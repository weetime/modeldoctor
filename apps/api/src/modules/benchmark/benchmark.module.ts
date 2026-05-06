import { assertScenariosInvariant } from "@modeldoctor/tool-adapters";
import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineModule } from "../baseline/baseline.module.js";
import { BenchmarkTemplateModule } from "../benchmark-template/benchmark-template.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
import { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";
import { SseHub } from "./sse/sse-hub.service.js";

@Module({
  imports: [ConfigModule, ConnectionModule, BenchmarkTemplateModule, BaselineModule],
  controllers: [BenchmarkController, BenchmarkCallbackController],
  providers: [
    PrismaService,
    BenchmarkRepository,
    BenchmarkService,
    BenchmarkChartsService,
    SseHub,
    {
      // Wire up the runner with a real KubeConfig + apiClients. The
      // dynamic import keeps `@kubernetes/client-node` (and its native
      // deps) out of any path that doesn't actually create a Job —
      // notably `NODE_ENV=test` where tests stub or skip the client.
      provide: K8sBenchmarkRunner,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>): Promise<K8sBenchmarkRunner> => {
        const ns =
          (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string | undefined) ??
          "modeldoctor-benchmarks";
        const stub = (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__;
        const k8s = stub
          ? (stub() as typeof import("@kubernetes/client-node"))
          : await import("@kubernetes/client-node");
        const kc = new k8s.KubeConfig();
        const explicitKubeconfig = config.get("KUBECONFIG", { infer: true }) as string | undefined;
        if (explicitKubeconfig) {
          kc.loadFromFile(explicitKubeconfig);
        } else {
          kc.loadFromDefault();
        }
        return new K8sBenchmarkRunner(
          ns,
          kc.makeApiClient(k8s.BatchV1Api),
          kc.makeApiClient(k8s.CoreV1Api),
        );
      },
    },
  ],
  exports: [BenchmarkRepository, BenchmarkService, BenchmarkChartsService, SseHub],
})
export class BenchmarkModule implements OnModuleInit {
  onModuleInit() {
    assertScenariosInvariant();
  }
}
