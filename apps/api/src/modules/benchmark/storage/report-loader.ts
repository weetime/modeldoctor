import { type ReportMeta, type ReportResult, reportStorageKeys } from "@modeldoctor/contracts";
import { byTool as defaultByTool, type ToolName } from "@modeldoctor/tool-adapters";
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { NotifyService } from "../../notifications/notify.service.js";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { IN_PROGRESS_STATES } from "../constants.js";
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
