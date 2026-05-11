import { PageHeader } from "@/components/common/page-header";
import { ChannelsSection } from "@/features/notifications/ChannelsSection";
import { useTranslation } from "react-i18next";
import { GlobalSubscriptionsSection } from "./GlobalSubscriptionsSection";

export function SettingsNotificationsPage(): JSX.Element {
  const { t } = useTranslation("settings");
  const { t: tSidebar } = useTranslation("sidebar");
  const breadcrumbs = [
    { label: tSidebar("items.settings") },
    { label: tSidebar("items.settings"), to: "/settings" },
    { label: t("notifications.page.breadcrumb") },
  ];
  return (
    <>
      <PageHeader
        title={t("notifications.page.title")}
        subtitle={t("notifications.page.subtitle")}
        breadcrumbs={breadcrumbs}
      />
      <div className="px-8 py-6 space-y-8">
        <ChannelsSection />
        <GlobalSubscriptionsSection />
      </div>
    </>
  );
}
