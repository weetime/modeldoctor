import type { CoreV1Api, KubeConfig, V1Pod } from "@kubernetes/client-node";
import { assertScenariosInvariant } from "@modeldoctor/tool-adapters";
import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineModule } from "../baseline/baseline.module.js";
import { BenchmarkTemplateModule } from "../benchmark-template/benchmark-template.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
import { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";
import { K8sJobWatcherService, type WatcherMode } from "./k8s/k8s-job-watcher.service.js";
import { DEFAULT_FATAL_WAITING_REASONS } from "./k8s/pod-state-reducer.js";
import { StartupReconciler } from "./k8s/startup-reconciler.js";
import type { ReportLoader } from "./storage/report-loader.js";
import { SseHub } from "./sse/sse-hub.service.js";

async function loadKubeConfig(config: ConfigService<Env, true>): Promise<KubeConfig> {
  const k8s = await import("@kubernetes/client-node");
  const kc = new k8s.KubeConfig();
  const explicit = config.get("KUBECONFIG", { infer: true }) as string | undefined;
  if (explicit) kc.loadFromFile(explicit);
  else kc.loadFromDefault();
  return kc;
}

@Module({
  imports: [
    ConfigModule,
    ConnectionModule,
    BenchmarkTemplateModule,
    BaselineModule,
    NotificationsModule,
  ],
  controllers: [BenchmarkController, BenchmarkCallbackController],
  providers: [
    PrismaService,
    BenchmarkRepository,
    BenchmarkService,
    BenchmarkChartsService,
    SseHub,
    {
      // K8sBenchmarkRunner — existing wiring (unchanged from before).
      provide: K8sBenchmarkRunner,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>): Promise<K8sBenchmarkRunner> => {
        const ns =
          (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string | undefined) ??
          "modeldoctor-benchmarks";
        const k8s = await import("@kubernetes/client-node");
        const kc = await loadKubeConfig(config);
        return new K8sBenchmarkRunner(
          ns,
          kc.makeApiClient(k8s.BatchV1Api),
          kc.makeApiClient(k8s.CoreV1Api),
        );
      },
    },
    {
      // K8sJobWatcherService — Phase 1 backstop watcher.
      // useFactory loads KubeConfig + builds Informer factory + StartupReconciler.
      // Note: WatcherDeps is constructor-injected as a single object (not 6
      // separate @Inject calls) so the makeInformer factory closure can capture
      // the KubeConfig + namespace without leaking them into module-level DI.
      provide: K8sJobWatcherService,
      inject: [ConfigService, BenchmarkRepository],
      useFactory: async (
        config: ConfigService<Env, true>,
        repo: BenchmarkRepository,
      ): Promise<K8sJobWatcherService> => {
        const mode = config.get("K8S_WATCHER_MODE", { infer: true }) as WatcherMode;
        const namespace = config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string;
        const waitingFatalGraceSec = config.get("WAITING_FATAL_GRACE_SEC", {
          infer: true,
        }) as number;
        const terminalReconcileGraceSec = config.get("TERMINAL_RECONCILE_GRACE_SEC", {
          infer: true,
        }) as number;

        const reducerConfig = {
          fatalWaitingReasons: DEFAULT_FATAL_WAITING_REASONS,
          waitingFatalGraceSec,
          terminalReconcileGraceSec,
        };

        // Stub reportLoader — replaced in T12 when S3ReportStorage + ReportLoader
        // are wired as proper NestJS providers. Until then this satisfies the
        // WatcherDeps type and prevents type-check failures.
        const reportLoaderStub: ReportLoader = {
          tryLoad: async (runId: string) => {
            // TODO(T12): replace with injected ReportLoader
            void runId;
          },
        } as unknown as ReportLoader;

        if (mode === "off") {
          // mode=off: build a service that no-ops on init/destroy. Avoids
          // loading K8s entirely in dev / CI / unit-test envs.
          return new K8sJobWatcherService({
            mode,
            namespace,
            reducerConfig,
            makeInformer: () => {
              throw new Error("makeInformer called in mode=off");
            },
            repo,
            reconciler: new StartupReconciler({
              namespace,
              repo,
              podCache: { get: () => undefined, list: () => [] },
            }),
            reportLoader: reportLoaderStub,
          });
        }

        // mode=backstop (or primary, which the service constructor rejects).
        // Real informer + reconciler with live K8s client.
        const k8s = await import("@kubernetes/client-node");
        const kc = await loadKubeConfig(config);
        const coreV1: CoreV1Api = kc.makeApiClient(k8s.CoreV1Api);
        const podPath = `/api/v1/namespaces/${namespace}/pods`;
        const labelSelector = "app.kubernetes.io/name=modeldoctor-run";
        const listFn = () =>
          coreV1.listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            labelSelector,
          );
        const informer = k8s.makeInformer<V1Pod>(kc, podPath, listFn, labelSelector);
        const reconciler = new StartupReconciler({
          namespace,
          repo,
          podCache: informer,
        });

        return new K8sJobWatcherService({
          mode,
          namespace,
          reducerConfig,
          makeInformer: () => informer,
          repo,
          reconciler,
          reportLoader: reportLoaderStub,
        });
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
