// apps/web/src/features/insights/ForceMap.tsx
import type { InsightsMatrixResponse } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import { GraphChart } from "echarts/charts";
import * as echarts from "echarts/core";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChartFrame, themed, useChartTokens } from "@/components/charts/_shared";

// The `_shared` import below (ChartFrame/themed/useChartTokens) already
// registers TooltipComponent / LegendComponent / CanvasRenderer as a module
// side effect — NOT Chart.tsx, which ForceMap doesn't import at all. Only
// GraphChart is missing, since no other chart in the app uses the `graph`
// series type. Register it here, independently, following the same
// per-module precedent as ScatterPanel.tsx. If `_shared` is ever refactored
// to drop that import, or its own registration set narrows, this graph will
// silently stop rendering tooltips/legend — keep this comment (and the
// import) in sync.
echarts.use([GraphChart]);

export interface ForceMapProps {
  data: InsightsMatrixResponse;
  onNodeClick: (endpointId: string) => void;
}

type NodeKind = "dimension" | "endpoint";

interface ForceMapNodeDatum {
  id: string;
  name: string;
  category: 0 | 1;
  symbolSize: number;
  itemStyle: { color: string };
  kind: NodeKind;
  /** Present on endpoint nodes only — the id `onNodeClick` navigates with. */
  endpointId?: string;
  /** Aggregate score (best/representative across the endpoint's cells), or
   * null when the endpoint has no scored cell yet. Endpoint nodes only. */
  score?: number | null;
  /** Total runs across the endpoint's cells. Endpoint nodes only. */
  runs?: number;
  /** Number of cells contributing to this dimension. Dimension nodes only. */
  count?: number;
}

interface ForceMapLinkDatum {
  source: string;
  target: string;
  lineStyle: { width: number };
}

// Same 3 thresholds as MatrixGrid's chipClass / ScoreBanner's severityClass
// (>=85 emerald, >=60 amber, <60 rose), translated to hex for canvas fill
// (Tailwind classes don't apply inside an ECharts canvas).
const SCORE_COLOR = {
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  muted: "#9ca3af",
};

// Neutral accent for dimension nodes — distinct from the score palette above
// so dimension vs. endpoint reads at a glance regardless of health.
const DIMENSION_COLOR = "#6366f1";

const ENDPOINT_MIN_SIZE = 8;
const ENDPOINT_MAX_SIZE = 40;
// Dimension nodes are fixed-ish and slightly larger than the endpoint max —
// per brief, dimensions are the graph's structural anchors, not scored.
const DIMENSION_SIZE = 44;

const LINK_MIN_WIDTH = 1;
const LINK_MAX_WIDTH = 6;

function scoreColor(score: number | null | undefined): string {
  if (score == null) return SCORE_COLOR.muted;
  if (score >= 85) return SCORE_COLOR.emerald;
  if (score >= 60) return SCORE_COLOR.amber;
  return SCORE_COLOR.rose;
}

function scaleLinear(value: number, domain: [number, number], range: [number, number]): number {
  const [domainMin, domainMax] = domain;
  const [rangeMin, rangeMax] = range;
  if (domainMax <= domainMin) return (rangeMin + rangeMax) / 2;
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

function dimNodeId(dimKey: string): string {
  return `dim:${dimKey}`;
}

function endpointNodeId(endpointId: string): string {
  return `ep:${endpointId}`;
}

interface GraphClickEvent {
  dataType?: string;
  data?: ForceMapNodeDatum;
}

/**
 * Bipartite force-directed graph for the Map view of the Test Insights
 * matrix: one node per dimension (scenario/tool/engine), one node per
 * endpoint, one link per cell. Endpoint node size encodes total runs,
 * color encodes aggregate health (same 3-band thresholds as MatrixGrid);
 * link width encodes the individual cell's run count. Clicking an
 * endpoint node navigates via `onNodeClick`; dimension nodes and links
 * are inert.
 */
export function ForceMap({ data, onNodeClick }: ForceMapProps) {
  const { t } = useTranslation("insights");
  const tokens = useChartTokens();

  const isEmpty = data.dimensions.length === 0 || data.endpoints.length === 0;

  const option = useMemo<EChartsOption>(() => {
    function dimLabel(key: string, fallback: string): string {
      if (data.aggregate === "scenario") {
        return t(`detail.scenario.${key}`, { defaultValue: fallback });
      }
      return fallback;
    }

    const runsByEndpoint = new Map<string, number>();
    const bestScoreByEndpoint = new Map<string, number | null>();
    for (const endpoint of data.endpoints) {
      runsByEndpoint.set(endpoint.id, 0);
      bestScoreByEndpoint.set(endpoint.id, null);
    }
    for (const cell of data.cells) {
      runsByEndpoint.set(cell.endpointId, (runsByEndpoint.get(cell.endpointId) ?? 0) + cell.runs);
      if (cell.score != null) {
        const prev = bestScoreByEndpoint.get(cell.endpointId);
        if (prev == null || cell.score > prev) {
          bestScoreByEndpoint.set(cell.endpointId, cell.score);
        }
      }
    }

    const endpointRunValues = [...runsByEndpoint.values()];
    const minRuns = endpointRunValues.length > 0 ? Math.min(...endpointRunValues) : 0;
    const maxRuns = endpointRunValues.length > 0 ? Math.max(...endpointRunValues) : 0;

    const cellRunValues = data.cells.map((c) => c.runs);
    const minCellRuns = cellRunValues.length > 0 ? Math.min(...cellRunValues) : 0;
    const maxCellRuns = cellRunValues.length > 0 ? Math.max(...cellRunValues) : 0;

    const dimNodes: ForceMapNodeDatum[] = data.dimensions.map((dim) => ({
      id: dimNodeId(dim.key),
      name: dimLabel(dim.key, dim.label),
      category: 0,
      symbolSize: DIMENSION_SIZE,
      itemStyle: { color: DIMENSION_COLOR },
      kind: "dimension",
      count: dim.count,
    }));

    const endpointNodes: ForceMapNodeDatum[] = data.endpoints.map((endpoint) => {
      const runs = runsByEndpoint.get(endpoint.id) ?? 0;
      const score = bestScoreByEndpoint.get(endpoint.id) ?? null;
      return {
        id: endpointNodeId(endpoint.id),
        name: `${endpoint.model} · ${endpoint.name}`,
        category: 1,
        symbolSize: scaleLinear(runs, [minRuns, maxRuns], [ENDPOINT_MIN_SIZE, ENDPOINT_MAX_SIZE]),
        itemStyle: { color: scoreColor(score) },
        kind: "endpoint",
        endpointId: endpoint.id,
        score,
        runs,
      };
    });

    const links: ForceMapLinkDatum[] = data.cells.map((cell) => ({
      source: dimNodeId(cell.dimKey),
      target: endpointNodeId(cell.endpointId),
      lineStyle: {
        width: scaleLinear(cell.runs, [minCellRuns, maxCellRuns], [LINK_MIN_WIDTH, LINK_MAX_WIDTH]),
      },
    }));

    const categoryDimension = t("matrix.map.categoryDimension", { defaultValue: "Dimension" });
    const categoryEndpoint = t("matrix.map.categoryEndpoint", { defaultValue: "Endpoint" });
    const scoreLabel = t("matrix.map.tooltipScore", { defaultValue: "Score" });
    const runsLabel = t("matrix.map.tooltipRuns", { defaultValue: "Runs" });
    const countLabel = t("matrix.map.tooltipCount", { defaultValue: "Cells" });
    const unscored = t("matrix.map.tooltipUnscored", { defaultValue: "Unscored" });

    return themed(
      {
        legend: [{ data: [categoryDimension, categoryEndpoint], top: 0 }],
        tooltip: {
          trigger: "item",
          formatter: (params: unknown) => {
            const p = params as GraphClickEvent;
            if (p.dataType !== "node" || !p.data) return "";
            const d = p.data;
            if (d.kind === "endpoint") {
              return [
                `<b>${d.name}</b>`,
                `${scoreLabel}: ${d.score ?? unscored}`,
                `${runsLabel}: ${d.runs ?? 0}`,
              ].join("<br/>");
            }
            return [`<b>${d.name}</b>`, `${countLabel}: ${d.count ?? 0}`].join("<br/>");
          },
        },
        series: [
          {
            type: "graph",
            layout: "force",
            roam: true,
            draggable: true,
            force: { repulsion: 120, edgeLength: 80 },
            categories: [{ name: categoryDimension }, { name: categoryEndpoint }],
            label: { show: true, position: "right", fontSize: 11 },
            emphasis: {
              focus: "adjacency",
              lineStyle: { width: 6 },
            },
            data: [...dimNodes, ...endpointNodes],
            links,
          },
        ],
      },
      tokens,
    );
  }, [data, tokens, t]);

  return (
    <div className="rounded-md border border-border p-4">
      <ChartFrame
        ariaLabel={t("matrix.map.title", { defaultValue: "Endpoint map" })}
        height={600}
        empty={isEmpty ? t("matrix.map.empty", { defaultValue: "No data" }) : false}
      >
        <ReactECharts
          option={option}
          style={{ height: "100%", width: "100%" }}
          notMerge
          lazyUpdate
          onEvents={{
            click: (params: GraphClickEvent) => {
              if (params.dataType === "node" && params.data?.kind === "endpoint") {
                const id = params.data.endpointId;
                if (id) onNodeClick(id);
              }
            },
          }}
        />
      </ChartFrame>
    </div>
  );
}
