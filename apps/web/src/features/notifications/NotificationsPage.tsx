import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";
import { ChannelsSection } from "./ChannelsSection";
import { SubscriptionsSection } from "./SubscriptionsSection";

export function NotificationsPage(): JSX.Element {
  const { t } = useTranslation("notifications");
  return (
    <>
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />
      <div className="px-8 py-6 space-y-6">
        <ChannelsSection />
        <SubscriptionsSection />
      </div>
    </>
  );
}
