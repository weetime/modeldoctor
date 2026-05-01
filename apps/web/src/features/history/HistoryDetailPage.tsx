import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

export function HistoryDetailPage() {
  const { t } = useTranslation("history");
  const { runId } = useParams<{ runId: string }>();
  return (
    <>
      <PageHeader title={runId ?? "—"} subtitle={t("detail.subtitle", { kind: "?", tool: "?", when: "?" })} />
      <div className="px-8 py-6 text-muted-foreground">…</div>
    </>
  );
}
