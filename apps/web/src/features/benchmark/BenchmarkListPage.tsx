import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function BenchmarkListPage() {
  const { t } = useTranslation("benchmark");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="px-8 py-6 text-sm text-muted-foreground">
        Benchmark list — implementation arrives in Task 2.
      </div>
    </>
  );
}
