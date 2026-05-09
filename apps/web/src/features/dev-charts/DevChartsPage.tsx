import {
  BarChartPanel,
  Gauge,
  LatencyCDF,
  LineTimeseries,
  PercentileTimeseries,
  PieChartPanel,
  QPSTimeseries,
  Stat,
  TTFTHistogram,
  assignRunColors,
  useChartTokens,
} from "@/components/charts";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { RUN_ID_LIST, fixtures } from "./fixtures";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border pb-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export function DevChartsPage() {
  const tokens = useChartTokens();
  const colorMap = useMemo(() => assignRunColors(RUN_ID_LIST, tokens.palette), [tokens]);
  const largeColorMap = useMemo(() => assignRunColors(["large"], tokens.palette), [tokens]);

  // inline fixtures — small enough to keep in this dev-only page
  const STAT_THRESHOLDS = [
    { at: 0.95, severity: "ok" as const },
    { at: 0.9, severity: "warn" as const },
    { at: 0, severity: "crit" as const },
  ];

  const NOW = Math.floor(Date.now() / 1000);
  const lineSeries = [
    {
      name: "p50",
      samples: Array.from(
        { length: 60 },
        (_, i) => [NOW - (60 - i) * 30, 120 + Math.sin(i / 5) * 20] as [number, number],
      ),
    },
    {
      name: "p95",
      samples: Array.from(
        { length: 60 },
        (_, i) => [NOW - (60 - i) * 30, 200 + Math.sin(i / 4) * 35] as [number, number],
      ),
    },
    {
      name: "p99",
      samples: Array.from(
        { length: 60 },
        (_, i) => [NOW - (60 - i) * 30, 280 + Math.sin(i / 3) * 60] as [number, number],
      ),
    },
  ];

  const barSeries = [
    {
      name: "100",
      samples: Array.from(
        { length: 12 },
        (_, i) => [NOW - (12 - i) * 60, 5 + Math.floor(Math.random() * 4)] as [number, number],
      ),
    },
    {
      name: "500",
      samples: Array.from(
        { length: 12 },
        (_, i) => [NOW - (12 - i) * 60, 10 + Math.floor(Math.random() * 6)] as [number, number],
      ),
    },
    {
      name: "1k",
      samples: Array.from(
        { length: 12 },
        (_, i) => [NOW - (12 - i) * 60, 7 + Math.floor(Math.random() * 5)] as [number, number],
      ),
    },
  ];

  const pieData = [
    { name: "stop", value: 120 },
    { name: "length", value: 18 },
    { name: "abort", value: 4 },
    { name: "error", value: 1 },
  ];

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Charts dev demo</h1>
        <p className="text-sm text-muted-foreground">
          Visual QA for the chart layer. Mock data only; remove during the #51 sidebar reorganize.
        </p>
      </header>

      <Section title="PercentileTimeseries">
        <Card title="3-Run overlay (50pts)">
          <PercentileTimeseries
            ariaLabel="3-run percentile"
            series={fixtures.threeRunPercentile}
            colorMap={colorMap}
          />
        </Card>
        <Card title="10k points">
          <PercentileTimeseries
            ariaLabel="10k percentile"
            series={fixtures.largePercentile}
            colorMap={largeColorMap}
          />
        </Card>
      </Section>

      <Section title="LatencyCDF">
        <Card title="3-Run overlay">
          <LatencyCDF ariaLabel="3-run cdf" series={fixtures.threeRunCDF} colorMap={colorMap} />
        </Card>
        <Card title="10k samples">
          <LatencyCDF ariaLabel="10k cdf" series={fixtures.largeCDF} colorMap={largeColorMap} />
        </Card>
      </Section>

      <Section title="TTFTHistogram">
        <Card title="3-Run overlay">
          <TTFTHistogram
            ariaLabel="3-run hist"
            series={fixtures.threeRunHistogram}
            colorMap={colorMap}
          />
        </Card>
        <Card title="10k buckets">
          <TTFTHistogram
            ariaLabel="10k hist"
            series={fixtures.largeHistogram}
            colorMap={largeColorMap}
          />
        </Card>
      </Section>

      <Section title="QPSTimeseries">
        <Card title="3-Run overlay">
          <QPSTimeseries ariaLabel="3-run qps" series={fixtures.threeRunQPS} colorMap={colorMap} />
        </Card>
        <Card title="10k points">
          <QPSTimeseries ariaLabel="10k qps" series={fixtures.largeQPS} colorMap={largeColorMap} />
        </Card>
      </Section>

      <Section title="Stat">
        <Card title="OK band">
          <Stat ariaLabel="success rate" value={0.984} unit="ratio" thresholds={STAT_THRESHOLDS} />
        </Card>
        <Card title="Warn band">
          <Stat
            ariaLabel="success rate warn"
            value={0.92}
            unit="ratio"
            thresholds={STAT_THRESHOLDS}
          />
        </Card>
        <Card title="Crit band">
          <Stat
            ariaLabel="success rate crit"
            value={0.65}
            unit="ratio"
            thresholds={STAT_THRESHOLDS}
          />
        </Card>
        <Card title="Big number, no thresholds">
          <Stat ariaLabel="ttft" value={187} unit="ms" />
        </Card>
      </Section>

      <Section title="Gauge">
        <Card title="Percent (auto max=100)">
          <Gauge ariaLabel="prefix hit" value={87} unit="%" />
        </Card>
        <Card title="Ratio (auto max=1)">
          <Gauge ariaLabel="ratio gauge" value={0.42} unit="ratio" />
        </Card>
        <Card title="Count with explicit max">
          <Gauge ariaLabel="active reqs" value={32} unit="count" max={64} />
        </Card>
        <Card title="Empty">
          <Gauge ariaLabel="gauge empty" value={null} unit="%" empty />
        </Card>
      </Section>

      <Section title="LineTimeseries">
        <Card title="3 series, no overlay">
          <LineTimeseries ariaLabel="3-line" series={lineSeries} unit="ms" />
        </Card>
        <Card title="3 series + benchmark window markArea">
          <LineTimeseries
            ariaLabel="3-line with markArea"
            series={lineSeries}
            unit="ms"
            markArea={{ from: NOW - 30 * 30, to: NOW - 10 * 30 }}
          />
        </Card>
      </Section>

      <Section title="BarChart">
        <Card title="Stacked">
          <BarChartPanel ariaLabel="stacked bars" series={barSeries} unit="count" stack="hist" />
        </Card>
        <Card title="Grouped">
          <BarChartPanel ariaLabel="grouped bars" series={barSeries} unit="count" />
        </Card>
      </Section>

      <Section title="PieChart">
        <Card title="Finish reason breakdown">
          <PieChartPanel ariaLabel="finish reason" data={pieData} />
        </Card>
        <Card title="Empty">
          <PieChartPanel ariaLabel="pie empty" data={[]} empty />
        </Card>
      </Section>

      <Section title="Empty / Loading states">
        <Card title="Loading">
          <PercentileTimeseries ariaLabel="loading" series={[]} loading />
        </Card>
        <Card title="Empty">
          <PercentileTimeseries ariaLabel="empty" series={[]} />
        </Card>
      </Section>
    </div>
  );
}
