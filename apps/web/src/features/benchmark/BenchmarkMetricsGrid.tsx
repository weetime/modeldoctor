import type { BenchmarkMetricsSummary } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

interface TileProps {
  label: string;
  value: string;
  unit?: string;
  subtitle?: string;
  tone?: "success" | "danger" | "default";
}

function Tile({ label, value, unit, subtitle, tone = "default" }: TileProps) {
  const valueColor =
    tone === "success" ? "text-green-600" : tone === "danger" ? "text-red-600" : "text-foreground";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </div>
      {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
    </div>
  );
}

const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toFixed(1));

export function BenchmarkMetricsGrid({
  summary,
}: {
  summary: BenchmarkMetricsSummary | null | undefined;
}) {
  const { t } = useTranslation("benchmark");
  const m = summary;

  return (
    <div className="grid grid-cols-4 gap-2">
      <Tile
        label={t("detail.metrics.ttftMean")}
        value={fmt(m?.ttft.mean)}
        unit={m ? "ms" : undefined}
        subtitle={
          m
            ? `p50 ${m.ttft.p50.toFixed(0)} / p95 ${m.ttft.p95.toFixed(0)} / p99 ${m.ttft.p99.toFixed(0)}`
            : undefined
        }
      />
      <Tile
        label={t("detail.metrics.ttftP95")}
        value={fmt(m?.ttft.p95)}
        unit={m ? "ms" : undefined}
      />
      <Tile
        label={t("detail.metrics.ttftP99")}
        value={fmt(m?.ttft.p99)}
        unit={m ? "ms" : undefined}
      />
      <Tile
        label={t("detail.metrics.itlMean")}
        value={fmt(m?.itl.mean)}
        unit={m ? "ms" : undefined}
        subtitle={
          m
            ? `p50 ${m.itl.p50.toFixed(1)} / p95 ${m.itl.p95.toFixed(1)} / p99 ${m.itl.p99.toFixed(1)}`
            : undefined
        }
      />

      <Tile
        label={t("detail.metrics.itlP95")}
        value={fmt(m?.itl.p95)}
        unit={m ? "ms" : undefined}
      />
      <Tile
        label={t("detail.metrics.itlP99")}
        value={fmt(m?.itl.p99)}
        unit={m ? "ms" : undefined}
      />
      <Tile label={t("detail.metrics.outputTps")} value={fmt(m?.outputTokensPerSecond.mean)} />
      <Tile label={t("detail.metrics.rps")} value={fmt(m?.requestsPerSecond.mean)} />

      <Tile label={t("detail.metrics.concurrencyMean")} value={fmt(m?.concurrency.mean)} />
      <Tile
        label={t("detail.metrics.concurrencyMax")}
        value={m?.concurrency.max === undefined ? "—" : String(m.concurrency.max)}
      />
      <Tile
        label={t("detail.metrics.successCount")}
        value={m?.requests.success === undefined ? "—" : String(m.requests.success)}
        tone="success"
      />
      <Tile
        label={t("detail.metrics.errorCount")}
        value={m?.requests.error === undefined ? "—" : String(m.requests.error)}
        tone={(m?.requests.error ?? 0) > 0 ? "danger" : "default"}
      />
    </div>
  );
}
