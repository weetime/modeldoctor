import { Button } from "@/components/ui/button";
import { useConnections } from "@/features/connections/queries";
import { useChannels, useSubscriptions } from "@/features/notifications/queries";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { SettingSection } from "./settings-primitives";

export function NotificationsSettingsSection(): JSX.Element {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const { data: channels = [] } = useChannels();
  const { data: subscriptions = [] } = useSubscriptions();
  const { data: connections = [] } = useConnections();

  const counts = {
    slack: channels.filter((c) => c.type === "slack").length,
    feishu: channels.filter((c) => c.type === "feishu").length,
    dingtalk: channels.filter((c) => c.type === "dingtalk").length,
    webhook: channels.filter((c) => c.type === "webhook").length,
  };
  const connectionIdsWithSubs = new Set(
    subscriptions.map((s) => s.connectionId).filter(Boolean) as string[],
  );

  return (
    <SettingSection
      title={t("notifications.section.title")}
      description={t("notifications.section.subtitle")}
    >
      <div className="space-y-1 text-sm text-muted-foreground">
        {channels.length === 0 ? (
          <div>{t("notifications.section.empty")}</div>
        ) : (
          <div>{t("notifications.section.summaryCounts", counts)}</div>
        )}
        <div>
          {t("notifications.section.subscriptionsCoverage", {
            withSubs: connectionIdsWithSubs.size,
            total: connections.length,
          })}
        </div>
      </div>
      <div className="mt-3">
        <Button variant="outline" onClick={() => navigate("/settings/notifications")}>
          {t("notifications.section.manageButton")}
        </Button>
      </div>
    </SettingSection>
  );
}
