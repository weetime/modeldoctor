import type { CoreV1Api, KubeConfig, V1Pod } from "@kubernetes/client-node";
import { assertScenariosInvariant } from "@modeldoctor/tool-adapters";
import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { PrometheusFetcherService } from "../alerts/prometheus-fetcher.service.js";
import { BaselineModule } from "../baseline/baseline.module.js";
import { BenchmarkTemplateModule } from "../benchmark-template/benchmark-template.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { EngineMetricsModule } from "../engine-metrics/engine-metrics.module.js";
import { EngineMetricsService } from "../engine-metrics/engine-metrics.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { NotifyService } from "../notifications/notify.service.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { BenchmarkFilesController } from "./benchmark-files.controller.js";
import { BenchmarkReconciler } from "./k8s/benchmark-reconciler.js";
import { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";
import { K8sJobWatcherService, type WatcherMode } from "./k8s/k8s-job-watcher.service.js";
import {
  K8S_LOG_CLIENT,
  K8S_NAMESPACE,
  PodLogStreamerFactory,
} from "./k8s/pod-log-streamer-factory.js";
import { PodLogStreamerPool } from "./k8s/pod-log-streamer-pool.js";
import { DEFAULT_FATAL_WAITING_REASONS } from "./k8s/pod-state-reducer.js";
import { PrefixCacheSnapshotService } from "./prefix-cache/prefix-cache-snapshot.service.js";
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
    AlertsModule,
    EngineMetricsModule,
  ],
  controllers: [BenchmarkController, BenchmarkFilesController],
  providers: [
    PrismaService,
    BenchmarkRepository,
    BenchmarkService,
    BenchmarkChartsService,
    SseHub,
    PrefixCacheSnapshotService,
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
      inject: [
        REPORT_STORAGE,
        BenchmarkRepository,
        NotifyService,
        SseHub,
        PrefixCacheSnapshotService,
        PrometheusFetcherService,
        EngineMetricsService,
      ],
      useFactory: (
        storage: ReportStorage,
        repo: BenchmarkRepository,
        notify: NotifyService,
        sse: SseHub,
        prefixCacheSnapshot: PrefixCacheSnapshotService,
        promFetcher: PrometheusFetcherService,
        engineMetrics: EngineMetricsService,
      ): ReportLoader =>
        new ReportLoader({
          storage,
          repo,
          notify,
          sse,
          prefixCacheSnapshot,
          promFetcher,
          engineMetrics,
        }),
    },
    {
      provide: K8S_NAMESPACE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string =>
        (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string | undefined) ??
        "modeldoctor-benchmarks",
    },
    {
      provide: K8S_LOG_CLIENT,
      inject: [ConfigService],
      useFactory: async (
        config: ConfigService<Env, true>,
      ): Promise<Pick<import("@kubernetes/client-node").Log, "log">> => {
        const mode = config.get("K8S_WATCHER_MODE", { infer: true }) as WatcherMode;
        if (mode === "off") {
          // Tests / dev never call into real K8s — return a stub that throws if used.
          return {
            log: async () => {
              throw new Error("K8S_LOG_CLIENT unavailable in mode=off");
            },
          };
        }
        const k8s = await import("@kubernetes/client-node");
        const kc = await loadKubeConfig(config);
        return new k8s.Log(kc);
      },
    },
    PodLogStreamerFactory,
    PodLogStreamerPool,
    {
      // K8sJobWatcherService — Phase 2 primary watcher.
      // useFactory loads KubeConfig + builds Informer factory + BenchmarkReconciler.
      // Note: WatcherDeps is constructor-injected as a single object (not 6
      // separate @Inject calls) so the makeInformer factory closure can capture
      // the KubeConfig + namespace without leaking them into module-level DI.
      provide: K8sJobWatcherService,
      inject: [
        ConfigService,
        BenchmarkRepository,
        ReportLoader,
        REPORT_STORAGE,
        PodLogStreamerPool,
      ],
      useFactory: async (
        config: ConfigService<Env, true>,
        repo: BenchmarkRepository,
        reportLoader: ReportLoader,
        storage: ReportStorage,
        pool: PodLogStreamerPool,
      ): Promise<K8sJobWatcherService> => {
        const mode = config.get("K8S_WATCHER_MODE", { infer: true }) as WatcherMode;
        const namespace = config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string;
        const waitingFatalGraceSec = config.get("WAITING_FATAL_GRACE_SEC", {
          infer: true,
        }) as number;
        const reconcileIntervalMs =
          (config.get("BENCHMARK_RECONCILE_INTERVAL_SEC", { infer: true }) as number) * 1000;
        const orphanMinAgeMs =
          (config.get("BENCHMARK_ORPHAN_MIN_AGE_SEC", { infer: true }) as number) * 1000;

        const reducerConfig = {
          fatalWaitingReasons: DEFAULT_FATAL_WAITING_REASONS,
          waitingFatalGraceSec,
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
            reconciler: new BenchmarkReconciler({
              repo,
              listLivePods: async () => [],
              storage,
              reportLoader,
            }),
            reportLoader,
            pool,
            reconcileIntervalMs: 0,
            orphanMinAgeMs: 0,
          });
        }

        // mode=primary — real informer + reconciler
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
        // Reconciler reads pods via a FRESH API list (not the informer cache) so
        // it stays a valid safety net even when the informer's cache is stale
        // because the watch stream died.
        const reconciler = new BenchmarkReconciler({
          repo,
          listLivePods: async () => (await listFn()).body.items,
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
          pool,
          reconcileIntervalMs,
          orphanMinAgeMs,
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
