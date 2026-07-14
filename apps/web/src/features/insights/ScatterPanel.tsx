// apps/web/src/features/insights/ScatterPanel.tsx
import type { InsightsMatrixResponse, MatrixBand } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import { ScatterChart } from "echarts/charts";
import { GridComponent, MarkAreaComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChartFrame, themed, useChartTokens } from "@/components/charts/_shared";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { paretoFrontier } from "./paretoFrontier";

// Registered independently of _shared.tsx/Chart.tsx (each chart-producing
// module registers what it needs — see Chart.tsx precedent) so ScatterPanel
// renders correctly regardless of which other chart modules happened to load
// first.
echarts.use([ScatterChart, GridComponent, TooltipComponent, MarkAreaComponent, CanvasRenderer]);

export interface ScatterPanelProps {
  dimKey: string;
  dimLabel: string;
  data: InsightsMatrixResponse;
  onClose: () => void;
  onPointClick: (endpointId: string) => void;
}

interface ScatterPoint {
  endpointId: string;
  displayName: string;
  score: number;
  /** Real native-metric latency (ms), or null when the cell has none. */
  latency: number | null;
  /** Plotted y — real latency when available, else a deterministic offset. */
  y: number;
  band: MatrixBand | null;
  nativeMetric: { kind: string; value: number; unit: string } | null;
}

interface ScatterDatum {
  value: [number, number];
  symbolSize: number;
  itemStyle: { borderColor?: string; borderWidth?: number };
  endpointId: string;
  displayName: string;
  score: number;
  band: MatrixBand | null;
  nativeMetric: { kind: string; value: number; unit: string } | null;
}

// Low-opacity recommendation bands (0-60 rose / 60-85 amber / 85-100 emerald)
// — same score thresholds as MatrixGrid's chipClass/ScoreBanner's severityClass.
const BAND_COLORS = {
  rose: "rgba(244, 63, 94, 0.10)",
  amber: "rgba(245, 158, 11, 0.10)",
  emerald: "rgba(16, 185, 129, 0.10)",
};

const BAND_FALLBACK: Record<MatrixBand, string> = {
  recommended: "Recommended",
  usable: "Usable",
  "not-recommended": "Not recommended",
};

export function ScatterPanel({ dimKey, dimLabel, data, onClose, onPointClick }: ScatterPanelProps) {
  const { t } = useTranslation("insights");
  const tokens = useChartTokens();

  const endpointsById = useMemo(
    () => new Map(data.endpoints.map((e) => [e.id, e])),
    [data.endpoints],
  );

  const dimCells = useMemo(
    () => data.cells.filter((c) => c.dimKey === dimKey),
    [data.cells, dimKey],
  );

  const unscoredCount = useMemo(() => dimCells.filter((c) => c.score == null).length, [dimCells]);

  // Only scored cells become scatter points — unscored (score == null) cells
  // are surfaced as a count in the header, never plotted.
  const { points, hasRealY, frontierIds, noLatencyCount } = useMemo(() => {
    const scoredCells = dimCells.filter((c) => c.score != null);
    const hasReal = scoredCells.some((c) => c.nativeMetric != null);
    // In real-latency mode, scored cells WITHOUT a nativeMetric latency must
    // be excluded from the plotted series entirely — mixing a fabricated
    // `i % 5` y (0-4) among real millisecond latencies (hundreds/thousands)
    // would read as a false "very fast" outlier. They're surfaced as a count
    // in the header instead. In the degraded 1D-strip mode (no scored cell
    // has a latency at all) every point goes on the strip, unambiguously.
    const plottedCells = hasReal ? scoredCells.filter((c) => c.nativeMetric != null) : scoredCells;
    const pts: ScatterPoint[] = plottedCells.map((c, i) => {
      const endpoint = endpointsById.get(c.endpointId);
      const latency = c.nativeMetric?.value ?? null;
      return {
        endpointId: c.endpointId,
        displayName: endpoint ? `${endpoint.model} · ${endpoint.name}` : c.endpointId,
        // c.score narrowed non-null by the filter above.
        score: c.score as number,
        latency,
        // Real latency when present; otherwise a deterministic (never
        // Math.random()) vertical offset by index so points don't stack.
        y: latency ?? i % 5,
        band: c.band,
        nativeMetric: c.nativeMetric,
      };
    });
    // Pareto frontier is computed only over points that have a real latency —
    // in the degraded 1D-strip case (no point has a real y) it is empty.
    const frontier = hasReal
      ? paretoFrontier(
          pts
            .filter((p) => p.latency != null)
            .map((p) => ({ id: p.endpointId, x: p.score, y: p.latency as number })),
        )
      : new Set<string>();
    return {
      points: pts,
      hasRealY: hasReal,
      frontierIds: frontier,
      noLatencyCount: scoredCells.length - plottedCells.length,
    };
  }, [dimCells, endpointsById]);

  const option = useMemo<EChartsOption>(() => {
    function bandLabel(band: MatrixBand | null): string {
      if (!band) return t("matrix.scatter.bandUnknown", { defaultValue: "Unscored" });
      return t(`matrix.band.${band}`, { defaultValue: BAND_FALLBACK[band] });
    }

    const seriesData: ScatterDatum[] = points.map((p) => {
      const isFrontier = frontierIds.has(p.endpointId);
      return {
        value: [p.score, p.y],
        symbolSize: isFrontier ? 16 : 9,
        itemStyle: isFrontier ? { borderColor: tokens.textColor, borderWidth: 2 } : {},
        endpointId: p.endpointId,
        displayName: p.displayName,
        score: p.score,
        band: p.band,
        nativeMetric: p.nativeMetric,
      };
    });

    return themed(
      {
        tooltip: {
          trigger: "item",
          formatter: (params: unknown) => {
            const datum = (params as { data?: ScatterDatum })?.data;
            if (!datum) return "";
            const metric = datum.nativeMetric
              ? `${datum.nativeMetric.kind} ${datum.nativeMetric.value}${datum.nativeMetric.unit}`
              : "";
            return [
              `<b>${datum.displayName}</b>`,
              `${t("matrix.scatter.score", { defaultValue: "Score" })}: ${datum.score}`,
              `${t("matrix.scatter.bandLabel", { defaultValue: "Band" })}: ${bandLabel(datum.band)}`,
              metric,
            ]
              .filter(Boolean)
              .join("<br/>");
          },
        },
        xAxis: {
          type: "value",
          min: 0,
          max: 100,
          name: t("matrix.scatter.xAxis", { defaultValue: "Score" }),
          nameLocation: "middle",
          nameGap: 28,
        },
        yAxis: {
          type: "value",
          name: hasRealY ? t("matrix.scatter.yAxisLatency", { defaultValue: "Latency (ms)" }) : "",
          nameLocation: "middle",
          nameGap: 48,
          axisLabel: hasRealY ? {} : { show: false },
        },
        grid: { left: 64, right: 24, top: 24, bottom: 48 },
        series: [
          {
            type: "scatter" as const,
            data: seriesData,
            markArea: {
              silent: true,
              data: [
                [{ xAxis: 0, itemStyle: { color: BAND_COLORS.rose } }, { xAxis: 60 }],
                [{ xAxis: 60, itemStyle: { color: BAND_COLORS.amber } }, { xAxis: 85 }],
                [{ xAxis: 85, itemStyle: { color: BAND_COLORS.emerald } }, { xAxis: 100 }],
              ],
            },
          },
        ],
      },
      tokens,
    );
  }, [points, frontierIds, hasRealY, tokens, t]);

  const isEmpty = points.length === 0;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent data-testid="scatter-panel" side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{dimLabel}</SheetTitle>
          {unscoredCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("matrix.scatter.unscoredNote", {
                defaultValue: "{{count}} unscored",
                count: unscoredCount,
              })}
            </p>
          ) : null}
          {noLatencyCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("matrix.scatter.noLatency", {
                defaultValue: "{{count}} without latency data",
                count: noLatencyCount,
              })}
            </p>
          ) : null}
        </SheetHeader>
        <div className="mt-4">
          <ChartFrame
            ariaLabel={dimLabel}
            height={420}
            empty={isEmpty ? t("matrix.scatter.empty", { defaultValue: "No scored data" }) : false}
          >
            <ReactECharts
              option={option}
              style={{ height: "100%", width: "100%" }}
              notMerge
              lazyUpdate
              onEvents={{
                click: (params: { data?: { endpointId?: string } }) => {
                  const id = params?.data?.endpointId;
                  if (id) onPointClick(id);
                },
              }}
            />
          </ChartFrame>
        </div>
      </SheetContent>
    </Sheet>
  );
}
