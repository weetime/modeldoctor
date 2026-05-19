import {
  ENGINE_CAPABILITY,
  type EngineMetricSpec,
  type EngineMetricsPanelResult,
  type EngineMetricsSnapshotQuery,
  type EngineMetricsSnapshotResponse,
  getEngineManifest,
} from "@modeldoctor/contracts";
import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConnectionService } from "../connection/connection.service.js";
import { PromClient, type PromQueryRangeResult } from "./prom-client.js";

const DEFAULT_STEP_SECONDS = 15;

@Injectable()
export class EngineMetricsService {
  private readonly log = new Logger(EngineMetricsService.name);

  constructor(
    private readonly connections: ConnectionService,
    private readonly prom: PromClient,
  ) {}

  async fetchSnapshot(
    userId: string,
    connectionId: string,
    q: EngineMetricsSnapshotQuery,
  ): Promise<EngineMetricsSnapshotResponse> {
    const conn = await this.connections.getOwnedDecrypted(userId, connectionId);

    if (!conn.prometheusDatasource) {
      throw new HttpException(
        {
          reason: "engine_metrics_not_configured",
          detail: "no Prometheus datasource bound to this connection",
        },
        422,
      );
    }
    if (!conn.serverKind) {
      throw new HttpException(
        { reason: "engine_metrics_not_configured", detail: "missing serverKind" },
        422,
      );
    }
    const manifest = getEngineManifest(conn.serverKind as never);
    if (!manifest) {
      throw new HttpException(
        { reason: "engine_metrics_not_configured", detail: `no manifest for ${conn.serverKind}` },
        422,
      );
    }

    const from = new Date(q.from);
    const to = new Date(q.to);
    const step = q.step ?? DEFAULT_STEP_SECONDS;
    const promBaseUrl = conn.prometheusDatasource.baseUrl;
    const model = conn.model;

    const settled = await Promise.allSettled(
      manifest.metrics.map((spec) =>
        this.runMetric(spec, { baseUrl: promBaseUrl, model, from, to, step }),
      ),
    );

    const panels: EngineMetricsPanelResult[] = settled.map((r, i) => {
      const spec = manifest.metrics[i];
      if (r.status === "fulfilled") return r.value;
      this.log.warn(`panel ${spec.key} threw: ${(r.reason as Error).message}`);
      return {
        key: spec.key,
        unit: spec.unit,
        thresholds: spec.thresholds,
        unavailable: true,
        reason: "prom_error",
        series: [],
      };
    });

    return {
      engineId: manifest.engineId,
      capability: ENGINE_CAPABILITY[manifest.engineId],
      window: { from: q.from, to: q.to, step },
      panels,
    };
  }

  private async runMetric(
    spec: EngineMetricSpec,
    ctx: { baseUrl: string; model: string; from: Date; to: Date; step: number },
  ): Promise<EngineMetricsPanelResult> {
    let lastReason: PromQueryRangeResult["reason"] | undefined;

    for (const variant of spec.promql) {
      const query = this.renderTemplate(variant.expr, ctx.model);
      const r = await this.prom.queryRange({
        baseUrl: ctx.baseUrl,
        query,
        from: ctx.from,
        to: ctx.to,
        step: ctx.step,
      });
      if (!r.unavailable) {
        return {
          key: spec.key,
          unit: spec.unit,
          thresholds: spec.thresholds,
          unavailable: false,
          series: r.series,
        };
      }
      lastReason = r.reason;
    }

    return {
      key: spec.key,
      unit: spec.unit,
      thresholds: spec.thresholds,
      unavailable: true,
      reason: lastReason ?? "no_data",
      series: [],
    };
  }

  /** Defensive PromQL escape: `"` and `\` only. Real model_name labels are
   * typically simple identifiers but we play it safe. */
  private renderTemplate(expr: string, model: string): string {
    const escaped = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return expr.replaceAll("${model}", escaped);
  }
}
