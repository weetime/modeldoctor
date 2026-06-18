import { type ReportMeta, type ReportResult, reportStorageKeys } from "@modeldoctor/contracts";
import { byTool as defaultByTool, type ToolName } from "@modeldoctor/tool-adapters";
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { PrometheusFetcherService } from "../../alerts/prometheus-fetcher.service.js";
import type { NotifyService } from "../../notifications/notify.service.js";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { PrefixCacheSnapshotService } from "../prefix-cache/prefix-cache-snapshot.service.js";
import type { SseHub } from "../sse/sse-hub.service.js";
import type { ReportStorage } from "./report-storage.js";

const STATUS_MESSAGE_MAX = 2048;
const RAW_OUTPUT_TAIL_MAX = 64 * 1024;
const REPORT_FILES_TOTAL_MAX_BYTES = 500 * 1024 * 1024;

export interface ReportLoaderDeps {
  storage: ReportStorage;
  repo: BenchmarkRepository;
  notify: NotifyService;
  sse: SseHub;
  byTool?: typeof defaultByTool;
  /** Optional: when provided, a prefix-cache snapshot is taken after completion
   *  for `lb-strategy` benchmarks that have a Prometheus datasource.
   *  Both `prefixCacheSnapshot` and `promFetcher` must be provided together —
   *  the hook is silently skipped if either is absent. */
  prefixCacheSnapshot?: PrefixCacheSnapshotService;
  promFetcher?: PrometheusFetcherService;
}

@Injectable()
export class ReportLoader {
  private readonly log = new Logger(ReportLoader.name);
  private readonly byTool: typeof defaultByTool;

  constructor(private readonly deps: ReportLoaderDeps) {
    this.byTool = deps.byTool ?? defaultByTool;
  }

  async tryLoad(runId: string): Promise<void> {
    const bench = await this.deps.repo.findById(runId);
    if (!bench || !IN_PROGRESS_STATES.includes(bench.status as (typeof IN_PROGRESS_STATES)[number]))
      return;
    const keys = reportStorageKeys(runId);
    try {
      const [meta, result, stdout, stderr] = await Promise.all([
        this.deps.storage.readJson<ReportMeta>(keys.meta),
        this.deps.storage.readJson<ReportResult>(keys.result),
        this.deps.storage.readText(keys.stdout),
        this.deps.storage.readText(keys.stderr),
      ]);
      const files = await this.loadFiles(runId, result.files);
      const summary = this.byTool(bench.tool as ToolName).parseFinalReport(stdout, files);
      const updated = await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "completed",
        toolVersion: meta.toolVersion,
        statusMessage: null,
        summaryMetrics: (summary ?? null) as Prisma.InputJsonValue,
        rawOutput: {
          stdout: stdout.slice(-RAW_OUTPUT_TAIL_MAX),
          stderr: stderr.slice(-RAW_OUTPUT_TAIL_MAX),
          files: result.files,
        } as Prisma.InputJsonValue,
        completedAt: new Date(result.finishTimeIso),
      });
      if (updated && bench.userId) {
        await this.deps.notify.emit({
          eventType: "benchmark.completed",
          userId: bench.userId,
          connectionId: bench.connectionId ?? undefined,
          payload: {
            benchmarkId: bench.id,
            name: bench.name,
            status: "completed",
            scenario: bench.scenario,
            tool: bench.tool,
            connectionId: bench.connectionId,
            summaryMetrics: summary,
            message: null,
          },
        });
      }
      // Best-effort: snapshot prefix-cache metrics after completion.
      // Only runs when THIS worker won the guard race (updated != null).
      // Must NEVER throw or delay the completion path — the entire block is
      // wrapped in try/catch and all skips are silent.
      if (updated) {
        await this.trySnapshotPrefixCache({
          runId,
          scenario: bench.scenario,
          prometheusDatasourceId: bench.connection?.prometheusDatasourceId ?? null,
          connectionModel: bench.connection?.model ?? null,
          completedAt: updated.completedAt ?? null,
          startedAt: bench.startedAt ?? null,
        });
      }
    } catch (e) {
      const msg = `report load: ${(e as Error).message}`.slice(0, STATUS_MESSAGE_MAX);
      const updated = await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "failed",
        statusMessage: msg,
        completedAt: new Date(),
      });
      if (updated && bench.userId) {
        await this.deps.notify.emit({
          eventType: "benchmark.failed",
          userId: bench.userId,
          connectionId: bench.connectionId ?? undefined,
          payload: {
            benchmarkId: bench.id,
            name: bench.name,
            status: "failed",
            scenario: bench.scenario,
            tool: bench.tool,
            connectionId: bench.connectionId,
            summaryMetrics: null,
            message: msg,
          },
        });
      }
      this.log.warn(`tryLoad(${runId}) failed: ${(e as Error).message}`);
    } finally {
      this.deps.sse.close(runId);
    }
  }

  /**
   * Best-effort prefix-cache metric snapshot. Guards:
   *   1. Both `prefixCacheSnapshot` and `promFetcher` must be injected.
   *   2. scenario must be "lb-strategy".
   *   3. The connection must have an explicit `prometheusDatasourceId` binding.
   *      If there is no binding we skip entirely — we must NOT fall back to the
   *      workspace-default datasource (which would silently snapshot the wrong
   *      Prometheus for an unrelated connection).
   *   4. startedAt must be present.
   *
   * All failures are caught and logged as warnings — this method NEVER throws.
   */
  private async trySnapshotPrefixCache(opts: {
    runId: string;
    scenario: string;
    prometheusDatasourceId: string | null;
    connectionModel: string | null;
    completedAt: Date | null;
    startedAt: Date | null;
  }): Promise<void> {
    const { runId, scenario, prometheusDatasourceId, connectionModel, completedAt, startedAt } =
      opts;
    if (!this.deps.prefixCacheSnapshot || !this.deps.promFetcher) return;
    try {
      if (scenario !== "lb-strategy") return;
      // Graceful degrade: no explicit datasource binding → skip (never fall
      // back to the workspace default — that would be a wrong datasource).
      if (!prometheusDatasourceId) return;
      if (!startedAt) return;

      // Use the datasourceId path, which returns exactly that datasource (or
      // null if deleted) and does NOT fall back to the workspace default.
      const ds = await this.deps.promFetcher.resolveDatasourceByRef({
        datasourceId: prometheusDatasourceId,
      });
      if (!ds) return;

      const end = completedAt ?? new Date();
      const windowSec = Math.max(60, Math.ceil((end.getTime() - startedAt.getTime()) / 1000));
      const model = connectionModel ?? "";

      const ann = await this.deps.prefixCacheSnapshot.snapshot({ ds, model, windowSec, at: end });
      if (ann) {
        await this.deps.repo.mergeServerMetrics(runId, { prefixCache: ann });
      }
    } catch (e) {
      this.log.warn(`trySnapshotPrefixCache(${runId}) failed: ${(e as Error).message}`);
    }
  }

  private async loadFiles(
    runId: string,
    fileMap: Record<string, string>,
  ): Promise<Record<string, Buffer>> {
    const entries: Array<[string, Buffer]> = [];
    let totalSize = 0;
    for (const [alias, relPath] of Object.entries(fileMap)) {
      const key = `${runId}/${relPath}`;
      const bytes = await this.deps.storage.readBytes(key);
      totalSize += bytes.length;
      if (totalSize > REPORT_FILES_TOTAL_MAX_BYTES) {
        throw new Error(`report files exceed ${REPORT_FILES_TOTAL_MAX_BYTES} bytes limit`);
      }
      entries.push([alias, bytes]);
    }
    return Object.fromEntries(entries);
  }
}
