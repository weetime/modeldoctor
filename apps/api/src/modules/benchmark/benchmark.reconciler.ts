import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";

export interface BenchmarkK8sReader {
  readJob(name: string, namespace: string): Promise<{ status?: { failed?: number } }>;
  listJobPods(
    name: string,
    namespace: string,
  ): Promise<
    Array<{
      status?: {
        containerStatuses?: Array<{
          state?: { terminated?: { reason?: string; exitCode?: number; message?: string } };
        }>;
      };
    }>
  >;
}

export const BENCHMARK_K8S_READER = Symbol("BENCHMARK_K8S_READER");

const ACTIVE_STATES = ["submitted", "running"] as const;
const RACE_GUARD_MS = 5_000;

@Injectable()
export class BenchmarkReconciler {
  private readonly log = new Logger(BenchmarkReconciler.name);
  private readonly driverKind: string;
  private readonly maxDuration: number;
  private readonly namespace: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BENCHMARK_DRIVER) private readonly driver: BenchmarkExecutionDriver,
    config: ConfigService<Env, true>,
    @Optional()
    @Inject(BENCHMARK_K8S_READER)
    private readonly reader: BenchmarkK8sReader | null,
  ) {
    this.driverKind = (config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess") as string;
    this.maxDuration = config.get("BENCHMARK_DEFAULT_MAX_DURATION_SECONDS", {
      infer: true,
    }) as number;
    this.namespace = (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) ??
      "modeldoctor-benchmarks") as string;
  }

  @Cron("*/30 * * * * *")
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === "test") return;
    try {
      await this.reconcile();
    } catch (e) {
      this.log.error(`reconciler tick failed: ${(e as Error).message}`);
    }
  }

  async reconcile(): Promise<void> {
    const now = Date.now();
    const rows = (await this.prisma.benchmarkRun.findMany({
      where: { state: { in: [...ACTIVE_STATES] } },
    })) as Array<{
      id: string;
      state: string;
      jobName: string | null;
      startedAt: Date | null;
      createdAt: Date;
    }>;

    for (const row of rows) {
      // Race guard: a row created in the last 5s may be mid-`start()`.
      if (now - row.createdAt.getTime() < RACE_GUARD_MS) continue;

      const ageMs = row.startedAt ? now - row.startedAt.getTime() : 0;
      if (row.startedAt && ageMs > this.maxDuration * 1000) {
        await this.markRunaway(row);
        continue;
      }

      if (this.driverKind === "k8s" && this.reader && row.jobName) {
        await this.checkK8sJob(row);
      }
    }
  }

  private async markRunaway(row: { id: string; jobName: string | null }): Promise<void> {
    if (row.jobName) {
      try {
        await this.driver.cancel(row.jobName);
      } catch (e) {
        this.log.warn(`cancel during runaway mark for ${row.id} failed: ${(e as Error).message}`);
      }
    }
    await this.prisma.benchmarkRun.update({
      where: { id: row.id },
      data: {
        state: "failed",
        stateMessage: "exceeded max duration",
        completedAt: new Date(),
      },
    });
  }

  private async checkK8sJob(row: { id: string; jobName: string | null }): Promise<void> {
    if (!this.reader || !row.jobName) return;
    const slash = row.jobName.indexOf("/");
    const ns = slash > 0 ? row.jobName.slice(0, slash) : this.namespace;
    const name = slash > 0 ? row.jobName.slice(slash + 1) : row.jobName;
    let job: { status?: { failed?: number } } | null = null;
    try {
      job = await this.reader.readJob(name, ns);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) {
        await this.prisma.benchmarkRun.update({
          where: { id: row.id },
          data: {
            state: "failed",
            stateMessage: "job vanished",
            completedAt: new Date(),
          },
        });
        return;
      }
      this.log.warn(`readJob failed for ${row.id}: ${(e as Error).message}`);
      return;
    }
    if (job?.status?.failed && job.status.failed > 0) {
      let reason = "pod failed";
      try {
        const pods = await this.reader.listJobPods(name, ns);
        const term = pods[0]?.status?.containerStatuses?.[0]?.state?.terminated;
        if (term) {
          const r = term.reason ?? "Unknown";
          const ec = term.exitCode ?? -1;
          reason = `pod failed: ${r} (exit ${ec})`;
        }
      } catch (e) {
        this.log.warn(`listJobPods failed for ${row.id}: ${(e as Error).message}`);
      }
      await this.prisma.benchmarkRun.update({
        where: { id: row.id },
        data: {
          state: "failed",
          stateMessage: reason.slice(0, 2048),
          completedAt: new Date(),
        },
      });
    }
  }
}
