import type { Run } from "@modeldoctor/contracts";
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

export function RunDetailMetadata({ run }: { run: Run }) {
  const { t } = useTranslation("runs");
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
      <Row label={t("detail.metadata.kind")}>{run.kind}</Row>
      <Row label={t("detail.metadata.tool")}>{run.tool}</Row>
      <Row label={t("detail.metadata.mode")}>{run.mode}</Row>
      <Row label={t("detail.metadata.driverKind")}>{run.driverKind}</Row>
      <Row label={t("detail.metadata.status")}>{run.status}</Row>
      <Row label={t("detail.metadata.connection")}>
        {run.connection?.name ?? t("detail.metadata.connectionMissing")}
      </Row>
      <Row label={t("detail.metadata.createdAt")}>{fmtDate(run.createdAt)}</Row>
      <Row label={t("detail.metadata.startedAt")}>{fmtDate(run.startedAt)}</Row>
      <Row label={t("detail.metadata.completedAt")}>{fmtDate(run.completedAt)}</Row>
      <Row label={t("detail.metadata.duration")}>{fmtDuration(run.startedAt, run.completedAt)}</Row>
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
