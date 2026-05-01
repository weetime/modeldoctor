import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function HistoryListPage() {
  const { t } = useTranslation("history");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="px-8 py-6 text-muted-foreground">…</div>
    </>
  );
}
