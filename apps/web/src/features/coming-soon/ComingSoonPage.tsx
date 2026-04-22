import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface ComingSoonPageProps {
  icon: LucideIcon;
  title: string;
}

export function ComingSoonPage({ icon, title }: ComingSoonPageProps) {
  const { t } = useTranslation("common");
  return (
    <div className="px-8 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("comingSoon.title")}</p>
      </div>
      <EmptyState
        icon={icon}
        title={t("comingSoon.title")}
        body={t("comingSoon.body")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/load-test">
              <ArrowLeft className="h-4 w-4" />
              {t("comingSoon.backToLoadTest")}
            </Link>
          </Button>
        }
      />
    </div>
  );
}
