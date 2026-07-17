import type { Benchmark } from "@modeldoctor/contracts";
import {
  type VllmOmniBenchReport,
  vllmOmniBenchReportSchema,
} from "@modeldoctor/tool-adapters/schemas";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChartFrame, themed, useChartTokens } from "@/components/charts/_shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UnknownReport } from "./UnknownReport";

export interface OmniReportProps {
  benchmark: Benchmark;
}

type CurvePoint = VllmOmniBenchReport["curve"][number];

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

/** audio-arm, ok-status points sorted by concurrency — the only points that
 * carry AUDIO_RTF / AUDIO_TTFP stats (text-arm and failed points are null). */
function audioOkPoints(report: VllmOmniBenchReport): CurvePoint[] {
  return report.curve
    .filter((p) => p.arm === "audio" && p.status === "ok")
    .sort((a, b) => a.concurrency - b.concurrency);
}

function curveSeries(
  points: CurvePoint[],
  pick: (p: CurvePoint) => number | null,
): Array<[number, number | null]> {
  return points.map((p) => [p.concurrency, pick(p)]);
}

/**
 * Omni-scenario (vllm-omni-bench) report container. Renders the header stat
 * tiles (realtime ceiling, TTFP at the lowest concurrency, RTF at the
 * realtime-ceiling peak, voice tax), the AUDIO_RTF and AUDIO_TTFP vs.
 * concurrency curves, and — when the run swept a voice-tax text-arm
 * comparison — a per-level Δ E2EL bar chart plus any adapter warnings.
 */
export function OmniReport({ benchmark }: OmniReportProps) {
  const { t } = useTranslation("benchmarks");
  const tokens = useChartTokens();
  const tagged = benchmark.summaryMetrics as { tool?: string; data?: unknown } | null;
  const parsed = vllmOmniBenchReportSchema.safeParse(tagged?.data);
  // Nullable pre-guard view of the parsed report, so the useMemo hooks below can
  // be called unconditionally (rules-of-hooks) — the real, narrowed `r` is
  // derived after the early-return once `parsed.success` is known.
  const parsedReport: VllmOmniBenchReport | null = parsed.success ? parsed.data : null;

  const points = useMemo(() => (parsedReport ? audioOkPoints(parsedReport) : []), [parsedReport]);
  const taxLevels = useMemo(
    () =>
      parsedReport
        ? Object.keys(parsedReport.derived.voiceTaxMsByLevel).sort((a, b) => Number(a) - Number(b))
        : [],
    [parsedReport],
  );

  const rtfOption = useMemo<EChartsOption>(
    () =>
      themed(
        {
          grid: { top: 24, right: 16, bottom: 32, left: 48 },
          xAxis: { type: "value", name: t("reports.omni.concurrency"), minInterval: 1 },
          yAxis: { type: "value", name: "RTF" },
          tooltip: { trigger: "axis" },
          series: [
            {
              name: "AUDIO_RTF (mean)",
              type: "line",
              data: curveSeries(points, (p) => p.audioRtf?.mean ?? null),
              markLine: {
                silent: true,
                symbol: "none",
                // ChartTokens (components/charts/theme.ts) doesn't expose a
                // danger/destructive color — this dashed line marks the fixed
                // realtime=1 threshold, so it intentionally stays a constant red
                // rather than following the theme palette.
                lineStyle: { type: "dashed", color: "#ef4444" },
                data: [{ yAxis: 1, label: { formatter: t("reports.omni.realtimeLine") } }],
              },
            },
          ],
        },
        tokens,
      ),
    [points, t, tokens],
  );

  const ttfpOption = useMemo<EChartsOption>(
    () =>
      themed(
        {
          grid: { top: 24, right: 16, bottom: 32, left: 56 },
          xAxis: { type: "value", name: t("reports.omni.concurrency"), minInterval: 1 },
          yAxis: { type: "value", name: "TTFP (ms)" },
          tooltip: { trigger: "axis" },
          legend: { top: 0 },
          series: [
            {
              name: "mean",
              type: "line",
              data: curveSeries(points, (p) => p.audioTtfpMs?.mean ?? null),
            },
            {
              name: "p99",
              type: "line",
              data: curveSeries(points, (p) => p.audioTtfpMs?.p99 ?? null),
            },
          ],
        },
        tokens,
      ),
    [points, t, tokens],
  );

  const taxOption = useMemo<EChartsOption>(
    () =>
      themed(
        {
          grid: { top: 24, right: 16, bottom: 32, left: 56 },
          xAxis: { type: "category", data: taxLevels, name: t("reports.omni.concurrency") },
          yAxis: { type: "value", name: "Δ E2EL (ms)" },
          tooltip: { trigger: "axis" },
          series: [
            {
              name: t("reports.omni.voiceTax"),
              type: "bar",
              data: taxLevels.map((k) => parsedReport?.derived.voiceTaxMsByLevel[k] ?? 0),
            },
          ],
        },
        tokens,
      ),
    [taxLevels, parsedReport, t, tokens],
  );

  if (!parsed.success) {
    return <UnknownReport benchmark={benchmark} reason={parsed.error.message} />;
  }
  const r: VllmOmniBenchReport = parsed.data;

  const peak = points.find((p) => p.concurrency === r.derived.peakConcurrency);
  const c1 = points[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <StatTile
          label={t("reports.omni.realtimeCeiling")}
          value={r.derived.realtimeCeiling > 0 ? `c=${r.derived.realtimeCeiling}` : "—"}
          sub={t("reports.omni.realtimeCeilingSub")}
        />
        <StatTile
          label={t("reports.omni.ttfpC1")}
          value={c1?.audioTtfpMs ? `${Math.round(c1.audioTtfpMs.mean)} ms` : "—"}
        />
        <StatTile
          label={t("reports.omni.rtfPeak")}
          value={peak?.audioRtf ? peak.audioRtf.mean.toFixed(2) : "—"}
        />
        <StatTile
          label={t("reports.omni.voiceTax")}
          value={r.derived.voiceTaxMs !== null ? `${Math.round(r.derived.voiceTaxMs)} ms` : "—"}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("reports.omni.rtfChart")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartFrame
            ariaLabel={t("reports.omni.rtfChart")}
            height={280}
            empty={points.length === 0}
          >
            <ReactECharts
              option={rtfOption}
              style={{ height: "100%", width: "100%" }}
              notMerge
              lazyUpdate
            />
          </ChartFrame>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("reports.omni.ttfpChart")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartFrame
            ariaLabel={t("reports.omni.ttfpChart")}
            height={280}
            empty={points.length === 0}
          >
            <ReactECharts
              option={ttfpOption}
              style={{ height: "100%", width: "100%" }}
              notMerge
              lazyUpdate
            />
          </ChartFrame>
        </CardContent>
      </Card>
      {taxLevels.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.omni.taxChart")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartFrame ariaLabel={t("reports.omni.taxChart")} height={240}>
              <ReactECharts
                option={taxOption}
                style={{ height: "100%", width: "100%" }}
                notMerge
                lazyUpdate
              />
            </ChartFrame>
          </CardContent>
        </Card>
      ) : null}
      {r.warnings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.omni.warnings")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
