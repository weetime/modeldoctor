// apps/web/src/features/playground/chat/ChatPage.tsx (Task 6 stub — replaced in Task 13)
import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function ChatPage() {
  const { t } = useTranslation("playground");
  return (
    <>
      <PageHeader title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <div className="px-8 py-6 text-sm text-muted-foreground">Stub — built in Task 13.</div>
    </>
  );
}
