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
import { NotifyService } from "../notifications/notify.service.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { BenchmarkFilesController } from "./benchmark-files.controller.js";
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
import { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";
import { K8sJobWatcherService, type WatcherMode } from "./k8s/k8s-job-watcher.service.js";
import { DEFAULT_FATAL_WAITING_REASONS } from "./k8s/pod-state-reducer.js";
import { StartupReconciler } from "./k8s/startup-reconciler.js";
import { SseHub } from "./sse/sse-hub.service.js";
import { ReportLoader } from "./storage/report-loader.js";
import { REPORT_STORAGE, type ReportStorage } from "./storage/report-storage.js";
import { S3ReportStorage } from "./storage/s3-report-storage.js";

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
  controllers: [BenchmarkController, BenchmarkCallbackController, BenchmarkFilesController],
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
      provide: REPORT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ReportStorage => {
        return new S3ReportStorage({
          endpoint: config.get("S3_ENDPOINT", { infer: true }) as string,
          region: config.get("S3_REGION", { infer: true }) as string,
          accessKeyId: config.get("S3_ACCESS_KEY", { infer: true }) as string,
          secretAccessKey: config.get("S3_SECRET_KEY", { infer: true }) as string,
          bucket: config.get("S3_BUCKET", { infer: true }) as string,
        });
      },
    },
    {
      provide: ReportLoader,
      inject: [REPORT_STORAGE, BenchmarkRepository, NotifyService, SseHub],
      useFactory: (
        storage: ReportStorage,
        repo: BenchmarkRepository,
        notify: NotifyService,
        sse: SseHub,
      ): ReportLoader => new ReportLoader({ storage, repo, notify, sse }),
    },
    {
      // K8sJobWatcherService — Phase 2 primary watcher.
      // useFactory loads KubeConfig + builds Informer factory + StartupReconciler.
      // Note: WatcherDeps is constructor-injected as a single object (not 6
      // separate @Inject calls) so the makeInformer factory closure can capture
      // the KubeConfig + namespace without leaking them into module-level DI.
      provide: K8sJobWatcherService,
      inject: [ConfigService, BenchmarkRepository, ReportLoader, REPORT_STORAGE],
      useFactory: async (
        config: ConfigService<Env, true>,
        repo: BenchmarkRepository,
        reportLoader: ReportLoader,
        storage: ReportStorage,
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
              storage,
              reportLoader,
            }),
            reportLoader,
          });
        }

        // mode=backstop or primary — real informer + reconciler
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
          storage,
          reportLoader,
        });

        return new K8sJobWatcherService({
          mode,
          namespace,
          reducerConfig,
          makeInformer: () => informer,
          repo,
          reconciler,
          reportLoader,
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
