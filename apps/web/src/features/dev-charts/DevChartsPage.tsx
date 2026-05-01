import {
  LatencyCDF,
  PercentileTimeseries,
  QPSTimeseries,
  TTFTHistogram,
  assignRunColors,
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
  const colorMap = useMemo(() => assignRunColors(RUN_ID_LIST), []);
  const largeColorMap = useMemo(() => assignRunColors(["large"]), []);

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
        <Card title="Loading">
          <PercentileTimeseries ariaLabel="loading" series={[]} loading />
        </Card>
        <Card title="Empty">
          <PercentileTimeseries ariaLabel="empty" series={[]} />
        </Card>
      </Section>

      <Section title="LatencyCDF">
        <Card title="3-Run overlay">
          <LatencyCDF ariaLabel="3-run cdf" series={fixtures.threeRunCDF} colorMap={colorMap} />
        </Card>
        <Card title="10k samples">
          <LatencyCDF ariaLabel="10k cdf" series={fixtures.largeCDF} colorMap={largeColorMap} />
        </Card>
        <Card title="Loading">
          <LatencyCDF ariaLabel="loading" series={[]} loading />
        </Card>
        <Card title="Empty">
          <LatencyCDF ariaLabel="empty" series={[]} />
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
        <Card title="Loading">
          <TTFTHistogram ariaLabel="loading" series={[]} loading />
        </Card>
        <Card title="Empty">
          <TTFTHistogram ariaLabel="empty" series={[]} />
        </Card>
      </Section>

      <Section title="QPSTimeseries">
        <Card title="3-Run overlay">
          <QPSTimeseries ariaLabel="3-run qps" series={fixtures.threeRunQPS} colorMap={colorMap} />
        </Card>
        <Card title="10k points">
          <QPSTimeseries ariaLabel="10k qps" series={fixtures.largeQPS} colorMap={largeColorMap} />
        </Card>
        <Card title="Loading">
          <QPSTimeseries ariaLabel="loading" series={[]} loading />
        </Card>
        <Card title="Empty">
          <QPSTimeseries ariaLabel="empty" series={[]} />
        </Card>
      </Section>
    </div>
  );
}
