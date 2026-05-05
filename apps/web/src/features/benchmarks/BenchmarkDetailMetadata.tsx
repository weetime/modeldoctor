import type { Benchmark } from "@modeldoctor/contracts";
import { format, formatDistanceStrict } from "date-fns";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return format(new Date(iso), "yyyy-MM-dd HH:mm:ss");
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  return formatDistanceStrict(new Date(end), new Date(start));
}

export function BenchmarkDetailMetadata({ benchmark }: { benchmark: Benchmark }) {
  const { t } = useTranslation("benchmarks");
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
      <Row label={t("detail.metadata.scenario")}>{benchmark.scenario}</Row>
      <Row label={t("detail.metadata.tool")}>{benchmark.tool}</Row>
      <Row label={t("detail.metadata.driverKind")}>{benchmark.driverKind}</Row>
      <Row label={t("detail.metadata.status")}>{benchmark.status}</Row>
      <Row label={t("detail.metadata.connection")}>
        {benchmark.connection?.name ?? t("detail.metadata.connectionMissing")}
      </Row>
      <Row label={t("detail.metadata.createdAt")}>{fmtDate(benchmark.createdAt)}</Row>
      <Row label={t("detail.metadata.startedAt")}>{fmtDate(benchmark.startedAt)}</Row>
      <Row label={t("detail.metadata.completedAt")}>{fmtDate(benchmark.completedAt)}</Row>
      <Row label={t("detail.metadata.duration")}>
        {fmtDuration(benchmark.startedAt, benchmark.completedAt)}
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
